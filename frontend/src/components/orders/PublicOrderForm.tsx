import React, { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { useForm } from "react-hook-form";
import {
  Calendar,
  Check,
  Circle,
  Clock,
  Hash,
  Phone,
  RectangleHorizontal,
  Send,
  Sparkles,
  Square,
  User,
} from "lucide-react";
import { conditionalFieldVariants } from "@/config/animations";
import { THEME_CONFIG } from "@/config/theme.config";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { StickerCard } from "@/components/ui/StickerCard";
import { LiveStickerPreview } from "@/components/orders/LiveStickerPreview";
import { StickerDropzone } from "@/components/orders/StickerDropzone";
import { publicOrderSchema, type PublicOrderFormValues } from "@/schemas/order.schema";
import { ordersService } from "@/services/orders.service";
import type { PublicOrderConfirmation, StickerShape } from "@/types/order";
import { getLocalTodayIsoDate, getNextAvailableDeliverySlot } from "@/utils/date";
import { useToast } from "@/hooks/useToast";

interface PublicOrderFormProps {
  onOrderCreated: (confirmation: PublicOrderConfirmation, previewUrl: string | null) => void;
}

const shapeIcons: Record<StickerShape, React.ComponentType<{ className?: string }>> = {
  Circular: Circle,
  Rectangular: RectangleHorizontal,
  Cuadrado: Square,
  "En su forma": Sparkles,
};

export const PublicOrderForm: React.FC<PublicOrderFormProps> = ({ onOrderCreated }) => {
  const { pushToast } = useToast();
  const initialSlot = useMemo(() => getNextAvailableDeliverySlot(), []);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
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

  // Clear conditional fields cleanly whenever material or shape changes
  useEffect(() => {
    if (watched.material !== "Vinilo Brillo" && watched.vinyl_gloss_mode) {
      setValue("vinyl_gloss_mode", null, { shouldValidate: true });
    }
  }, [watched.material, watched.vinyl_gloss_mode, setValue]);

  useEffect(() => {
    if (watched.shape === "Circular") {
      if (watched.dimensions) setValue("dimensions", "", { shouldValidate: false });
    } else {
      if (watched.diameter_cm) setValue("diameter_cm", "", { shouldValidate: false });
    }
  }, [watched.shape, watched.dimensions, watched.diameter_cm, setValue]);

  // Revoke object URL on unmount only if not handed off
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleImageChange = (file: File | null) => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    if (file) {
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setPreviewUrl(null);
    }
    setValue("image", file, { shouldValidate: true });
  };

  const todayIso = getLocalTodayIsoDate();
  const currentHour = new Date().getHours();
  const isTodaySelected = watched.delivery_date === todayIso;

  const onSubmit = async (values: PublicOrderFormValues) => {
    if (!values.image) return;
    setServerError(null);
    try {
      const confirmation = await ordersService.createPublicOrder({
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
      });

      const clonedPreview = URL.createObjectURL(values.image);
      pushToast({
        title: `Pedido ${confirmation.order_number} registrado`,
        description: "Tu orden ya está en cola del taller.",
        variant: "success",
      });
      onOrderCreated(confirmation, clonedPreview);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "No se pudo registrar tu pedido. Intenta nuevamente.";
      setServerError(message);
      pushToast({ title: "No se pudo enviar el pedido", description: message, variant: "error" });
    }
  };

  return (
    <div className="grid grid-cols-1 gap-7 lg:grid-cols-12">
      {/* Left: Structured Multi-Section Interactive Form */}
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6 lg:col-span-7 xl:col-span-8">
        {/* Section 1: Contact */}
        <StickerCard padding="md">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-ink">
              1
            </span>
            <div>
              <h2 className="font-display text-base font-bold text-ink-primary">
                Datos de Contacto
              </h2>
              <p className="text-xs text-ink-muted">
                Para identificarte y coordinar la entrega por WhatsApp.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Nombre de Referido *"
              placeholder="Ej. María Fernández / Marca Local"
              leftIcon={<User className="h-4 w-4" />}
              error={errors.referral_name?.message}
              {...register("referral_name")}
            />
            <Input
              label="Número de Teléfono / WhatsApp *"
              placeholder="Ej. +591 71234567"
              inputMode="tel"
              leftIcon={<Phone className="h-4 w-4" />}
              error={errors.phone?.message}
              {...register("phone")}
            />
          </div>
        </StickerCard>

        {/* Section 2: Material + Conditional Vinilo Brillo Sub-Option */}
        <StickerCard padding="md">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-ink">
              2
            </span>
            <div>
              <h2 className="font-display text-base font-bold text-ink-primary">
                Material del Sticker *
              </h2>
              <p className="text-xs text-ink-muted">
                Elige el sustrato ideal según dónde se aplicarán tus stickers.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {THEME_CONFIG.materials.map((mat) => {
              const selected = watched.material === mat.value;
              return (
                <button
                  key={mat.value}
                  type="button"
                  onClick={() =>
                    setValue("material", mat.value, { shouldValidate: true, shouldDirty: true })
                  }
                  className={`group relative flex flex-col items-start rounded-lg border p-3.5 text-left transition-all ${
                    selected
                      ? "border-line-diecut bg-accent-soft/75 shadow-sm ring-1 ring-line-diecut"
                      : "border-line-subtle bg-surface-card hover:border-line-strong hover:bg-surface-elevated/60"
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-sm font-bold text-ink-primary">{mat.label}</span>
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${
                        selected
                          ? "border-accent bg-accent text-accent-ink"
                          : "border-line-strong text-transparent"
                      }`}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">{mat.description}</p>
                  <span className="mt-2 inline-block rounded-full border border-line-subtle bg-surface-card px-2 py-0.5 font-mono text-[10px] font-semibold text-ink-secondary">
                    {mat.badge}
                  </span>
                </button>
              );
            })}
          </div>
          {errors.material && (
            <p className="mt-2 text-xs font-semibold text-brand-800 dark:text-brand-200">
              • {errors.material.message}
            </p>
          )}

          {/* Conditional Sub-option for Vinilo Brillo */}
          <AnimatePresence initial={false}>
            {watched.material === "Vinilo Brillo" && (
              <motion.div
                key="vinyl-gloss-mode"
                variants={conditionalFieldVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="overflow-hidden"
              >
                <div className="mt-4 rounded-lg border-2 border-dashed border-line-diecut bg-surface-elevated/80 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-ink-primary">
                    Modalidad requerida para Vinilo Brillo *
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {THEME_CONFIG.vinylGlossModes.map((mode) => {
                      const active = watched.vinyl_gloss_mode === mode.value;
                      return (
                        <button
                          key={mode.value}
                          type="button"
                          onClick={() =>
                            setValue("vinyl_gloss_mode", mode.value, { shouldValidate: true })
                          }
                          className={`flex flex-col items-start rounded-md border p-3 text-left transition-all ${
                            active
                              ? "border-accent bg-accent text-accent-ink shadow-sm"
                              : "border-line-strong bg-surface-card text-ink-primary hover:bg-surface-elevated"
                          }`}
                        >
                          <span className="text-sm font-bold">{mode.label}</span>
                          <span
                            className={`mt-0.5 text-xs ${
                              active ? "opacity-90" : "text-ink-muted"
                            }`}
                          >
                            {mode.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {errors.vinyl_gloss_mode && (
                    <p
                      role="alert"
                      className="mt-2 text-xs font-semibold text-brand-800 dark:text-brand-200"
                    >
                      • {errors.vinyl_gloss_mode.message}
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </StickerCard>

        {/* Section 3: Shape + Conditional Size + Quantity */}
        <StickerCard padding="md">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-ink">
              3
            </span>
            <div>
              <h2 className="font-display text-base font-bold text-ink-primary">
                Forma, Tamaño y Cantidad
              </h2>
              <p className="text-xs text-ink-muted">
                El campo de medida se adapta automáticamente a la forma elegida.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {THEME_CONFIG.shapes.map((item) => {
              const Icon = shapeIcons[item.value];
              const selected = watched.shape === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setValue("shape", item.value, { shouldValidate: true })}
                  className={`flex flex-col items-center justify-center rounded-lg border p-3.5 text-center transition-all ${
                    selected
                      ? "border-line-diecut bg-accent text-accent-ink shadow-sm"
                      : "border-line-subtle bg-surface-card text-ink-primary hover:border-line-strong hover:bg-surface-elevated"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="mt-2 text-xs font-bold">{item.label}</span>
                  <span
                    className={`mt-0.5 text-[10px] ${
                      selected ? "opacity-85" : "text-ink-muted"
                    }`}
                  >
                    {item.hint}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Conditional Size Input: Circular -> ONLY Diameter; Others -> Single Alto x Ancho */}
            <AnimatePresence mode="wait">
              {watched.shape === "Circular" ? (
                <motion.div
                  key="diameter-input"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                >
                  <Input
                    label="Diámetro (cm) *"
                    type="number"
                    step="0.1"
                    min="0.5"
                    max="500"
                    placeholder="Ej. 5"
                    helperText="Medida única en centímetros para corte circular."
                    error={errors.diameter_cm?.message}
                    {...register("diameter_cm")}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="dimensions-input"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                >
                  <Input
                    label="Tamaño: Alto x Ancho *"
                    type="text"
                    placeholder="Ej. 5x7 cm"
                    helperText="Ingresa Alto x Ancho en un solo campo (ej. 5x7 cm o 6.5x8)."
                    error={errors.dimensions?.message}
                    {...register("dimensions")}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <Input
              label="Cantidad (unidades) *"
              type="number"
              min={1}
              step={1}
              placeholder="Ej. 100"
              leftIcon={<Hash className="h-4 w-4" />}
              helperText="Número entero positivo de stickers."
              error={errors.quantity?.message}
              {...register("quantity")}
            />
          </div>
        </StickerCard>

        {/* Section 4: Artwork Upload + Strict On-The-Hour Delivery Schedule */}
        <StickerCard padding="md" className="space-y-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-ink">
              4
            </span>
            <div>
              <h2 className="font-display text-base font-bold text-ink-primary">
                Arte del Sticker y Programación de Entrega
              </h2>
              <p className="text-xs text-ink-muted">
                La fecha de recepción se registra automáticamente al confirmar tu orden.
              </p>
            </div>
          </div>

          <StickerDropzone
            file={watched.image ?? null}
            previewUrl={previewUrl}
            error={errors.image?.message as string | undefined}
            onFileChange={handleImageChange}
          />

          <div className="grid grid-cols-1 gap-4 border-t border-line-subtle pt-5 sm:grid-cols-2">
            <Input
              label="Fecha de Entrega *"
              type="date"
              min={todayIso}
              leftIcon={<Calendar className="h-4 w-4" />}
              error={errors.delivery_date?.message}
              {...register("delivery_date")}
            />

            <Select
              label="Hora de Entrega (en punto :00) *"
              helperText={`Horario del taller: ${String(THEME_CONFIG.deliveryHours.startHour).padStart(2, "0")}:00 a ${String(THEME_CONFIG.deliveryHours.endHour).padStart(2, "0")}:00 (solo horas exactas).`}
              error={errors.delivery_hour?.message}
              {...register("delivery_hour")}
            >
              {THEME_CONFIG.deliveryHours.slots.map((slot) => {
                const slotHour = Number(slot.split(":")[0]);
                const disabled = isTodaySelected && slotHour <= currentHour;
                return (
                  <option key={slot} value={slot} disabled={disabled}>
                    {slot} hrs {disabled ? "(hora pasada)" : ""}
                  </option>
                );
              })}
            </Select>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-line-subtle bg-surface-elevated/70 px-3.5 py-2.5 text-xs text-ink-secondary">
            <Clock className="h-4 w-4 shrink-0 text-accent" />
            <span>
              <strong>Fecha de recepción automática:</strong> el servidor sellará la fecha y hora exacta
              al momento de registrar tu pedido.
            </span>
          </div>

          {serverError && (
            <div
              role="alert"
              className="rounded-lg border border-brand-800 bg-brand-950 px-4 py-3 text-xs font-medium text-brand-50 dark:border-brand-300 dark:bg-brand-900"
            >
              {serverError}
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] text-ink-muted">
              Al enviar, aceptas que revisemos la calidad de impresión de tu archivo.
            </p>
            <Button
              type="submit"
              size="lg"
              loading={isSubmitting}
              rightIcon={<Send className="h-4 w-4" />}
              className="sm:min-w-[240px]"
            >
              {isSubmitting
                ? THEME_CONFIG.copy.publicPortal.submittingLabel
                : THEME_CONFIG.copy.publicPortal.submitLabel}
            </Button>
          </div>
        </StickerCard>
      </form>

      {/* Right: Sticky Live Sticker Preview */}
      <div className="lg:col-span-5 xl:col-span-4">
        <div className="lg:sticky lg:top-24">
          <LiveStickerPreview
            previewUrl={previewUrl}
            referralName={watched.referral_name || ""}
            material={watched.material}
            vinylGlossMode={watched.vinyl_gloss_mode}
            shape={watched.shape}
            diameterCm={watched.diameter_cm}
            dimensions={watched.dimensions}
            quantity={watched.quantity}
            deliveryDate={watched.delivery_date}
            deliveryHour={watched.delivery_hour}
          />
        </div>
      </div>
    </div>
  );
};
