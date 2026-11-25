import React, { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { useFieldArray, useForm, type FieldErrors } from "react-hook-form";
import {
  AlertCircle,
  Calendar,
  Check,
  Clock,
  LayoutGrid,
  LayoutList,
  Layers,
  Phone,
  Scissors,
  Send,
  Sparkles,
  UploadCloud,
  User,
  Wand2,
} from "lucide-react";
import { THEME_CONFIG } from "@/config/theme.config";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { StickerCard } from "@/components/ui/StickerCard";
import { DesignItemCard } from "@/components/orders/DesignItemCard";
import {
  LiveStickerPreview,
  type LivePreviewDesignEntry,
} from "@/components/orders/LiveStickerPreview";
import {
  MAX_ORDER_DESIGNS,
  countTotalOrderDesignVariants,
  countTotalOrderUnits,
  flattenOrderDesignItemsForSubmission,
  publicOrderSchema,
  type OrderDesignItemFormValues,
  type PublicOrderFormValues,
} from "@/schemas/order.schema";
import {
  getFallbackPublicMaterials,
  mapPublicMaterialsToOptions,
  materialsService,
  type PublicMaterialOption,
} from "@/services/materials.service";
import { ordersService } from "@/services/orders.service";
import type {
  PublicOrderConfirmation,
  StickerMaterial,
  StickerShape,
  StickerSizeMode,
  VinylGlossMode,
} from "@/types/order";
import { getLocalTodayIsoDate, getNextAvailableDeliverySlot } from "@/utils/date";
import { useToast } from "@/hooks/useToast";

interface PublicOrderFormProps {
  onOrderCreated: (
    confirmation: PublicOrderConfirmation,
    previewUrls: (string | null)[]
  ) => void;
  selectedHeroFinish?: { material: StickerMaterial; nonce: number } | null;
}

interface QuickBatchPresetState {
  material: StickerMaterial;
  vinylGlossMode: VinylGlossMode;
  shape: StickerShape;
  diameterCm: string;
  sizeMode: StickerSizeMode;
  heightCm: string;
  widthCm: string;
  dimensions: string;
  quantity: number;
}

function createDefaultDesignItem(
  defaultMaterial: StickerMaterial = "Vinilo Mate",
  overrides?: Partial<OrderDesignItemFormValues>
): OrderDesignItemFormValues {
  const mat = overrides?.material ?? defaultMaterial;
  return {
    material: mat,
    vinyl_gloss_mode:
      mat === "Vinilo Brillo"
        ? (overrides?.vinyl_gloss_mode ?? "Corte uno a uno")
        : null,
    shape: overrides?.shape ?? "Circular",
    diameter_cm: overrides?.diameter_cm ?? "5",
    size_mode: overrides?.size_mode ?? "both",
    height_cm: overrides?.height_cm ?? "",
    width_cm: overrides?.width_cm ?? "",
    dimensions: overrides?.dimensions ?? "",
    quantity: overrides?.quantity ?? 50,
    image: overrides?.image ?? null,
    size_variants: overrides?.size_variants ?? [],
  };
}

function isAcceptedImageFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  const validExt = [".png", ".jpg", ".jpeg", ".webp", ".svg"].some((ext) =>
    lower.endsWith(ext)
  );
  const validMime = (THEME_CONFIG.upload.acceptedMimeTypes as readonly string[]).includes(
    file.type
  );
  return validMime || validExt;
}

export const PublicOrderForm: React.FC<PublicOrderFormProps> = ({
  onOrderCreated,
  selectedHeroFinish = null,
}) => {
  const { pushToast } = useToast();
  const initialSlot = useMemo(() => getNextAvailableDeliverySlot(), []);
  const [materialOptions, setMaterialOptions] = useState<PublicMaterialOption[]>(() =>
    getFallbackPublicMaterials()
  );
  const [catalogLive, setCatalogLive] = useState(false);

  // Keyed by File object URL cache or fieldId so batch-appended files render immediately
  const [previewUrlsById, setPreviewUrlsById] = useState<Record<string, string>>({});
  const previewUrlsRef = useRef<Record<string, string>>({});
  const fileObjectUrlMapRef = useRef<Map<File, string>>(new Map());

  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [serverError, setServerError] = useState<string | null>(null);

  // Batch dropzone & view mode states (auto-compact at >= 4 designs, with manual override)
  const batchInputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingBatch, setIsDraggingBatch] = useState(false);
  const [viewMode, setViewMode] = useState<"detailed" | "compact">("detailed");
  const hasAutoCompactedRef = useRef(false);

  // Quick Config ("Aplicar a todos los diseños") state
  const [quickPreset, setQuickPreset] = useState<QuickBatchPresetState>({
    material: "Vinilo Mate",
    vinylGlossMode: "Corte uno a uno",
    shape: "Circular",
    diameterCm: "5",
    sizeMode: "both",
    heightCm: "6",
    widthCm: "6",
    dimensions: "5x5 cm",
    quantity: 50,
  });

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    getFieldState,
    formState: { errors, isSubmitting },
  } = useForm<PublicOrderFormValues>({
    resolver: zodResolver(publicOrderSchema),
    defaultValues: {
      referral_name: "",
      phone: "",
      delivery_date: initialSlot.date,
      delivery_hour: initialSlot.hour,
      items: [createDefaultDesignItem()],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  // Helper to get or create a stable object URL for a File instance
  const getOrCreateFilePreviewUrl = (file: File | null | undefined): string | null => {
    if (!(file instanceof File)) return null;
    const cached = fileObjectUrlMapRef.current.get(file);
    if (cached) return cached;
    const created = URL.createObjectURL(file);
    fileObjectUrlMapRef.current.set(file, created);
    return created;
  };

  // Load real active materials catalog from `GET /api/v1/public/materials` (fallback to THEME_CONFIG)
  useEffect(() => {
    let cancelled = false;

    const loadCatalog = async () => {
      try {
        const res = await materialsService.listPublicMaterials();
        if (cancelled) return;
        const resolved = mapPublicMaterialsToOptions(res.items);
        setMaterialOptions(resolved);
        setCatalogLive(true);

        const firstMat = getValues("items.0.material");
        const firstDirty = getFieldState("items.0.material").isDirty;
        if (!firstDirty && resolved.length > 0 && !resolved.some((m) => m.value === firstMat)) {
          const fallbackMat = resolved[0].value;
          setValue("items.0.material", fallbackMat, { shouldValidate: false });
          if (fallbackMat === "Vinilo Brillo") {
            setValue("items.0.vinyl_gloss_mode", "Corte uno a uno", { shouldValidate: false });
          } else {
            setValue("items.0.vinyl_gloss_mode", null, { shouldValidate: false });
          }
          setQuickPreset((prev) => ({ ...prev, material: fallbackMat }));
        }
      } catch {
        if (!cancelled) {
          setMaterialOptions(getFallbackPublicMaterials());
          setCatalogLive(false);
        }
      }
    };

    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, [getFieldState, getValues, setValue]);

  // Apply finish clicked from the interactive "Sticker Pack" Hero onto the active design card
  useEffect(() => {
    if (!selectedHeroFinish) return;
    const isAvailable = materialOptions.some((m) => m.value === selectedHeroFinish.material);
    if (!isAvailable) return;

    const targetIndex = Math.min(Math.max(0, activePreviewIndex), Math.max(0, fields.length - 1));
    setValue(`items.${targetIndex}.material`, selectedHeroFinish.material, {
      shouldValidate: true,
      shouldDirty: true,
    });
    if (selectedHeroFinish.material === "Vinilo Brillo") {
      const currentGloss = getValues(`items.${targetIndex}.vinyl_gloss_mode`);
      if (!currentGloss) {
        setValue(`items.${targetIndex}.vinyl_gloss_mode`, "Corte uno a uno", {
          shouldValidate: true,
        });
      }
    } else {
      setValue(`items.${targetIndex}.vinyl_gloss_mode`, null, { shouldValidate: true });
    }
    setQuickPreset((prev) => ({ ...prev, material: selectedHeroFinish.material }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHeroFinish?.nonce]);

  const watched = watch();
  const watchedItems = watched.items ?? [];

  const totalFlattenedDesigns = useMemo(
    () => countTotalOrderDesignVariants(watchedItems),
    [watchedItems]
  );

  const totalUnits = useMemo(
    () => countTotalOrderUnits(watchedItems),
    [watchedItems]
  );

  const remainingDesignSlots = Math.max(0, MAX_ORDER_DESIGNS - totalFlattenedDesigns);

  // Automatically enable Compact View once when the customer reaches 4+ designs
  useEffect(() => {
    if (fields.length >= 4 && !hasAutoCompactedRef.current) {
      hasAutoCompactedRef.current = true;
      setViewMode("compact");
    } else if (fields.length < 4 && hasAutoCompactedRef.current && fields.length <= 2) {
      hasAutoCompactedRef.current = false;
      setViewMode("detailed");
    }
  }, [fields.length]);

  // Keep ref in sync so unmount revokes every active local object URL cleanly
  useEffect(() => {
    previewUrlsRef.current = previewUrlsById;
  }, [previewUrlsById]);

  useEffect(() => {
    const fileUrlMap = fileObjectUrlMapRef.current;
    return () => {
      Object.values(previewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      fileUrlMap.forEach((url) => URL.revokeObjectURL(url));
      fileUrlMap.clear();
    };
  }, []);

  const resolveItemPreviewUrl = (fieldId: string, item?: OrderDesignItemFormValues): string | null => {
    if (previewUrlsById[fieldId]) return previewUrlsById[fieldId];
    if (item?.image instanceof File) {
      return getOrCreateFilePreviewUrl(item.image);
    }
    return null;
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

  const defaultNewMaterial: StickerMaterial =
    materialOptions.find((m) => m.value === quickPreset.material)?.value ??
    materialOptions.find((m) => m.value === "Vinilo Mate")?.value ??
    materialOptions[0]?.value ??
    "Vinilo Mate";

  const buildItemFromQuickPreset = (imageFile: File | null = null): OrderDesignItemFormValues => {
    const isCirc = quickPreset.shape === "Circular";
    return createDefaultDesignItem(defaultNewMaterial, {
      material: defaultNewMaterial,
      vinyl_gloss_mode:
        defaultNewMaterial === "Vinilo Brillo" ? quickPreset.vinylGlossMode : null,
      shape: quickPreset.shape,
      diameter_cm: isCirc ? quickPreset.diameterCm || "5" : "",
      size_mode: !isCirc ? quickPreset.sizeMode : "both",
      height_cm: !isCirc && quickPreset.sizeMode === "height_only" ? quickPreset.heightCm || "6" : "",
      width_cm: !isCirc && quickPreset.sizeMode === "width_only" ? quickPreset.widthCm || "6" : "",
      dimensions:
        !isCirc && quickPreset.sizeMode === "both" ? quickPreset.dimensions || "5x5 cm" : "",
      quantity: Number(quickPreset.quantity) > 0 ? Number(quickPreset.quantity) : 50,
      image: imageFile,
      size_variants: [],
    });
  };

  /**
   * Batch multi-file upload handler (1 to 20 files at once):
   * Automatically populates empty slot #1 (if unused) and generates a card per uploaded file.
   */
  const handleBatchFilesUpload = (fileList: FileList | File[] | null) => {
    if (!fileList || isSubmitting) return;
    const rawFiles = Array.from(fileList);
    if (rawFiles.length === 0) return;

    const validFiles = rawFiles.filter(
      (f) => isAcceptedImageFile(f) && f.size <= THEME_CONFIG.upload.maxSizeBytes
    );
    const rejectedCount = rawFiles.length - validFiles.length;

    if (validFiles.length === 0) {
      pushToast({
        title: "Archivos no válidos",
        description: `Solo se aceptan imágenes PNG, JPG, WEBP o SVG de hasta ${THEME_CONFIG.upload.maxSizeMB} MB.`,
        variant: "error",
      });
      return;
    }

    const currentItems = getValues("items") ?? [];
    const firstSlotEmpty =
      currentItems.length === 1 &&
      !(currentItems[0]?.image instanceof File) &&
      (!currentItems[0]?.size_variants || currentItems[0].size_variants.length === 0);

    const currentTotalVariants = countTotalOrderDesignVariants(currentItems);
    const availableNewSlots = Math.max(
      0,
      MAX_ORDER_DESIGNS - currentTotalVariants + (firstSlotEmpty ? 1 : 0)
    );

    if (availableNewSlots === 0) {
      pushToast({
        title: `Límite de ${MAX_ORDER_DESIGNS} diseños alcanzado`,
        description: `Tu pedido ya cuenta con el máximo de ${MAX_ORDER_DESIGNS} diseños/medidas.`,
        variant: "error",
      });
      return;
    }

    const filesToLoad = validFiles.slice(0, availableNewSlots);
    const truncatedByLimit = validFiles.length - filesToLoad.length;

    let cursor = 0;
    if (firstSlotEmpty && filesToLoad.length > 0 && fields[0]) {
      const firstFile = filesToLoad[0];
      getOrCreateFilePreviewUrl(firstFile);
      handleDesignImageChange(fields[0].id, 0, firstFile);
      cursor = 1;
    }

    const newCards: OrderDesignItemFormValues[] = [];
    for (let i = cursor; i < filesToLoad.length; i += 1) {
      const file = filesToLoad[i];
      getOrCreateFilePreviewUrl(file);
      newCards.push(buildItemFromQuickPreset(file));
    }

    if (newCards.length > 0) {
      append(newCards);
    }

    const resultingCardsCount = currentItems.length + newCards.length;
    if (resultingCardsCount >= 4) {
      hasAutoCompactedRef.current = true;
      setViewMode("compact");
    }

    const extraNotes: string[] = [];
    if (truncatedByLimit > 0) {
      extraNotes.push(
        `Se omitieron ${truncatedByLimit} archivo(s) por el límite de ${MAX_ORDER_DESIGNS} diseños.`
      );
    }
    if (rejectedCount > 0) {
      extraNotes.push(`${rejectedCount} archivo(s) ignorados por formato o peso.`);
    }

    pushToast({
      title:
        filesToLoad.length === 1
          ? "1 diseño cargado a la mesa de corte"
          : `${filesToLoad.length} diseños cargados en lote`,
      description:
        extraNotes.join(" ") ||
        (resultingCardsCount >= 4
          ? "Vista compacta activada automáticamente para recorrer tus diseños."
          : "Configura medidas o usa la barra 'Aplicar a todos'."),
      variant: "success",
    });
  };

  /**
   * "Aplicar a todos los diseños" — Quick Batch Configuration Bar action
   */
  const handleApplyQuickPresetToAll = () => {
    const currentItems = getValues("items") ?? [];
    if (currentItems.length === 0) return;

    const isCirc = quickPreset.shape === "Circular";
    const resolvedGloss =
      quickPreset.material === "Vinilo Brillo" ? quickPreset.vinylGlossMode : null;
    const validQty =
      Number.isFinite(Number(quickPreset.quantity)) && Number(quickPreset.quantity) >= 1
        ? Math.round(Number(quickPreset.quantity))
        : 50;

    currentItems.forEach((item, idx) => {
      setValue(`items.${idx}.material`, quickPreset.material, {
        shouldValidate: true,
        shouldDirty: true,
      });
      setValue(`items.${idx}.vinyl_gloss_mode`, resolvedGloss, {
        shouldValidate: true,
        shouldDirty: true,
      });
      setValue(`items.${idx}.shape`, quickPreset.shape, {
        shouldValidate: true,
        shouldDirty: true,
      });

      if (isCirc) {
        setValue(`items.${idx}.diameter_cm`, quickPreset.diameterCm || "5", {
          shouldValidate: true,
          shouldDirty: true,
        });
        setValue(`items.${idx}.dimensions`, "", { shouldValidate: false });
        setValue(`items.${idx}.height_cm`, "", { shouldValidate: false });
        setValue(`items.${idx}.width_cm`, "", { shouldValidate: false });
      } else {
        setValue(`items.${idx}.diameter_cm`, "", { shouldValidate: false });
        setValue(`items.${idx}.size_mode`, quickPreset.sizeMode, {
          shouldValidate: true,
          shouldDirty: true,
        });
        if (quickPreset.sizeMode === "height_only") {
          setValue(`items.${idx}.height_cm`, quickPreset.heightCm || "6", {
            shouldValidate: true,
            shouldDirty: true,
          });
          setValue(`items.${idx}.width_cm`, "", { shouldValidate: false });
          setValue(`items.${idx}.dimensions`, "", { shouldValidate: false });
        } else if (quickPreset.sizeMode === "width_only") {
          setValue(`items.${idx}.width_cm`, quickPreset.widthCm || "6", {
            shouldValidate: true,
            shouldDirty: true,
          });
          setValue(`items.${idx}.height_cm`, "", { shouldValidate: false });
          setValue(`items.${idx}.dimensions`, "", { shouldValidate: false });
        } else {
          setValue(`items.${idx}.dimensions`, quickPreset.dimensions || "5x5 cm", {
            shouldValidate: true,
            shouldDirty: true,
          });
          setValue(`items.${idx}.height_cm`, "", { shouldValidate: false });
          setValue(`items.${idx}.width_cm`, "", { shouldValidate: false });
        }
      }

      setValue(`items.${idx}.quantity`, validQty, {
        shouldValidate: true,
        shouldDirty: true,
      });

      // Keep extra size_variants synchronized with the new shape mode if present
      if (Array.isArray(item.size_variants) && item.size_variants.length > 0) {
        const syncedVariants = item.size_variants.map((v, vIdx) => ({
          ...v,
          diameter_cm: isCirc ? v.diameter_cm || String(6 + vIdx) : "",
          size_mode: !isCirc ? (v.size_mode ?? quickPreset.sizeMode) : "both",
          dimensions:
            !isCirc && (v.size_mode ?? quickPreset.sizeMode) === "both"
              ? v.dimensions || `${6 + vIdx}x${6 + vIdx} cm`
              : v.dimensions,
          height_cm:
            !isCirc && (v.size_mode ?? quickPreset.sizeMode) === "height_only"
              ? v.height_cm || String(6 + vIdx)
              : v.height_cm,
          width_cm:
            !isCirc && (v.size_mode ?? quickPreset.sizeMode) === "width_only"
              ? v.width_cm || String(6 + vIdx)
              : v.width_cm,
        }));
        setValue(`items.${idx}.size_variants`, syncedVariants, {
          shouldValidate: true,
          shouldDirty: true,
        });
      }
    });

    pushToast({
      title: `Configuración aplicada a ${currentItems.length} diseños`,
      description: `${quickPreset.material} · ${quickPreset.shape} · ${validQty} uds. por diseño. Puedes ajustar cualquiera individualmente.`,
      variant: "success",
    });
  };

  const handleAddDesign = () => {
    if (totalFlattenedDesigns >= MAX_ORDER_DESIGNS) return;
    const nextIndex = fields.length;
    append(buildItemFromQuickPreset(null));
    setActivePreviewIndex(nextIndex);

    window.requestAnimationFrame(() => {
      const el = document.getElementById(`diseno-${nextIndex + 1}`);
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
    setActivePreviewIndex((prev) => {
      if (prev > index) return prev - 1;
      if (prev === index) return Math.max(0, index - 1);
      return prev;
    });
  };

  const todayIso = getLocalTodayIsoDate();
  const currentHour = new Date().getHours();
  const isTodaySelected = watched.delivery_date === todayIso;

  const previewEntries: LivePreviewDesignEntry[] = fields.map((field, idx) => {
    const item = watchedItems[idx] ?? createDefaultDesignItem();
    const extraVariantsQty = Array.isArray(item.size_variants)
      ? item.size_variants.reduce((acc, v) => acc + (Number(v?.quantity) || 0), 0)
      : 0;
    return {
      fieldId: field.id,
      previewUrl: resolveItemPreviewUrl(field.id, item),
      material: item.material,
      vinylGlossMode: item.vinyl_gloss_mode,
      shape: item.shape,
      diameterCm: item.diameter_cm,
      sizeMode: item.size_mode,
      heightCm: item.height_cm,
      widthCm: item.width_cm,
      dimensions: item.dimensions,
      quantity: (Number(item.quantity) || 0) + extraVariantsQty,
    };
  });

  const onInvalid = (formErrors: FieldErrors<PublicOrderFormValues>) => {
    if (Array.isArray(formErrors.items)) {
      const firstErrorIndex = formErrors.items.findIndex((entry) => Boolean(entry));
      if (firstErrorIndex >= 0) {
        setActivePreviewIndex(firstErrorIndex);
        const el = document.getElementById(`diseno-${firstErrorIndex + 1}`);
        el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  };

  const onSubmit = async (values: PublicOrderFormValues) => {
    if (values.items.some((item) => !item.image)) return;
    setServerError(null);

    try {
      // Flatten every card and its `+ Otra medida de este diseño` rows into `items[]`
      // sharing `image_index` so each unique image file is uploaded only once
      const { flattenedItems, uniqueImages } = flattenOrderDesignItemsForSubmission(values.items);

      const confirmation = await ordersService.createPublicOrder({
        referral_name: values.referral_name,
        phone: values.phone,
        delivery_date: values.delivery_date,
        delivery_hour: values.delivery_hour,
        items: flattenedItems,
        uniqueImages,
      });

      const clonedPreviews = flattenedItems.map((flatItem) =>
        flatItem.image ? URL.createObjectURL(flatItem.image) : null
      );

      const submittedTotalUnits = flattenedItems.reduce(
        (sum, it) => sum + (Number(it.quantity) || 0),
        0
      );
      const designsLabel =
        flattenedItems.length === 1
          ? "1 diseño"
          : `${flattenedItems.length} ítems (${uniqueImages.length} ${
              uniqueImages.length === 1 ? "archivo único" : "archivos únicos"
            } · ${submittedTotalUnits.toLocaleString()} stickers)`;

      pushToast({
        title: `Pedido ${confirmation.order_number} registrado`,
        description: `${designsLabel} en cola del taller.`,
        variant: "success",
      });
      onOrderCreated(confirmation, clonedPreviews);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "No se pudo registrar tu pedido. Intenta nuevamente.";
      setServerError(message);
      pushToast({
        title: "No se pudo enviar el pedido",
        description: message,
        variant: "error",
      });
    }
  };

  const itemsRootError =
    errors.items && !Array.isArray(errors.items) ? errors.items.message : undefined;

  return (
    <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-12">
      {/* Left Column: Customer & Delivery Header + Batch Upload + Quick Bar + Dynamic Design Cards */}
      <form
        onSubmit={handleSubmit(onSubmit, onInvalid)}
        noValidate
        className="space-y-6 lg:col-span-7 xl:col-span-8"
      >
        {/* Step 01 (Top): Customer Info & Exact-Hour Delivery Schedule */}
        <StickerCard id="paso-cliente-entrega" padding="md" className="scroll-mt-24 space-y-5">
          <div className="flex items-center justify-between gap-3 border-b border-dashed border-line-subtle pb-3.5">
            <div className="flex items-center gap-3">
              <span className="sticker-badge flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-xs font-extrabold text-accent-ink">
                01
              </span>
              <div>
                <h2 className="font-display text-base font-extrabold tracking-tight text-ink-primary">
                  Datos del Cliente y Entrega
                </h2>
                <p className="text-xs text-ink-muted">
                  Contacto para coordinación por WhatsApp y horario exacto de entrega del pedido.
                </p>
              </div>
            </div>
            <span className="hidden rounded-full bg-surface-elevated px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-ink-muted sm:inline-block">
              Paso 1 de 2
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Nombre de Referido *"
              placeholder="Ej. María Fernández / Marca Local"
              disabled={isSubmitting}
              leftIcon={<User className="h-4 w-4" />}
              error={errors.referral_name?.message}
              {...register("referral_name")}
            />
            <Input
              label="Número de Teléfono / WhatsApp *"
              placeholder="Ej. +591 71234567"
              inputMode="tel"
              disabled={isSubmitting}
              leftIcon={<Phone className="h-4 w-4" />}
              error={errors.phone?.message}
              {...register("phone")}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-dashed border-line-subtle pt-5 sm:grid-cols-2">
            <Input
              label="Fecha de Entrega *"
              type="date"
              min={todayIso}
              disabled={isSubmitting}
              leftIcon={<Calendar className="h-4 w-4" />}
              error={errors.delivery_date?.message}
              {...register("delivery_date")}
            />

            <Select
              label="Hora de Entrega (en punto :00) *"
              disabled={isSubmitting}
              helperText={`Horario del taller: ${String(THEME_CONFIG.deliveryHours.startHour).padStart(2, "0")}:00 a ${String(THEME_CONFIG.deliveryHours.endHour).padStart(2, "0")}:00 (solo horas exactas).`}
              error={errors.delivery_hour?.message}
              {...register("delivery_hour")}
            >
              {THEME_CONFIG.deliveryHours.slots.map((slot) => {
                const slotHour = Number(slot.split(":")[0]);
                const slotDisabled = isTodaySelected && slotHour <= currentHour;
                return (
                  <option key={slot} value={slot} disabled={slotDisabled}>
                    {slot} hrs {slotDisabled ? "(hora pasada)" : ""}
                  </option>
                );
              })}
            </Select>
          </div>

          <div className="flex items-start gap-2.5 rounded-lg border border-line-subtle bg-surface-elevated/70 px-3.5 py-3 text-xs text-ink-secondary">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <span>
              <strong className="text-ink-primary">Fecha de recepción automática:</strong> el
              servidor sellará la fecha y hora exacta al confirmar tu orden.
            </span>
          </div>
        </StickerCard>

        {/* Step 02: Dynamic List of Independent Sticker Design Cards (1 to 20 designs) */}
        <section id="paso-disenos" className="scroll-mt-24 space-y-4">
          {/* Header with Live Total Sticker Counter + Compact / Detailed View Toggle (>= 4 designs) */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-sticker border border-line-subtle bg-surface-card px-5 py-4 shadow-xs">
            <div className="flex items-center gap-3">
              <span className="sticker-badge flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-xs font-extrabold text-accent-ink">
                02
              </span>
              <div>
                <h2 className="font-display text-base font-extrabold tracking-tight text-ink-primary">
                  Diseños del Pedido (1 a {MAX_ORDER_DESIGNS})
                </h2>
                <p className="text-xs text-ink-muted">
                  Sube hasta {MAX_ORDER_DESIGNS} archivos de golpe, aplica ajustes en lote o agrega
                  varias medidas de un mismo diseño.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {catalogLive && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle bg-surface-elevated px-2.5 py-1 font-mono text-[10px] font-semibold text-ink-secondary">
                  <Sparkles className="h-3 w-3 text-accent" aria-hidden="true" />
                  Catálogo vivo · {materialOptions.length} materiales
                </span>
              )}

              {/* Live Sticker & Design Slot Counter */}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-diecut/75 bg-accent-soft px-3 py-1 font-mono text-[11px] font-extrabold tabular-nums text-ink-primary">
                <Layers className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                <span>
                  {totalFlattenedDesigns}/{MAX_ORDER_DESIGNS}{" "}
                  {totalFlattenedDesigns === 1 ? "diseño" : "diseños"}
                </span>
                <span aria-hidden="true" className="text-line-strong">
                  ·
                </span>
                <span className="text-accent">{totalUnits.toLocaleString()} stickers</span>
              </span>

              {/* Toggle Compact View / Detailed View when 4 or more designs are loaded */}
              {(fields.length >= 4 || totalFlattenedDesigns >= 4) && (
                <div
                  role="group"
                  aria-label="Modo de visualización de tarjetas"
                  className="inline-flex rounded-full border border-line-subtle bg-surface-elevated p-0.5 font-mono text-[10px] font-bold"
                >
                  <button
                    type="button"
                    aria-pressed={viewMode === "compact"}
                    onClick={() => setViewMode("compact")}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      viewMode === "compact"
                        ? "bg-accent text-accent-ink shadow-xs"
                        : "text-ink-secondary hover:text-ink-primary"
                    }`}
                  >
                    <LayoutGrid className="h-3 w-3" aria-hidden="true" />
                    <span>Vista compacta</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={viewMode === "detailed"}
                    onClick={() => setViewMode("detailed")}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      viewMode === "detailed"
                        ? "bg-accent text-accent-ink shadow-xs"
                        : "text-ink-secondary hover:text-ink-primary"
                    }`}
                  >
                    <LayoutList className="h-3 w-3" aria-hidden="true" />
                    <span>Vista detallada</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 1. Batch Multi-Upload Cutting-Mat Zone (Up to 20 designs at once) */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!isSubmitting && remainingDesignSlots > 0) {
                setIsDraggingBatch(true);
              }
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDraggingBatch(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDraggingBatch(false);
              if (isSubmitting) return;
              handleBatchFilesUpload(e.dataTransfer?.files ?? null);
            }}
            className={`relative overflow-hidden rounded-sticker border-2 border-dashed p-4 transition-all duration-fast ease-studio sm:p-5 ${
              isDraggingBatch
                ? "border-accent bg-accent-soft/70 shadow-sticker ring-2 ring-accent/40"
                : "border-line-diecut bg-surface-card/95 bg-print-grid shadow-xs hover:border-accent"
            }`}
          >
            <input
              ref={batchInputRef}
              type="file"
              multiple
              disabled={isSubmitting || remainingDesignSlots === 0}
              accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
              className="sr-only"
              onChange={(e) => {
                handleBatchFilesUpload(e.target.files);
                e.target.value = "";
              }}
            />

            <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3.5">
                <span
                  aria-hidden="true"
                  className="sticker-badge flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-ink shadow-sticker"
                >
                  <UploadCloud className="h-5 w-5" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-sm font-extrabold tracking-tight text-ink-primary sm:text-base">
                      Subida Múltiple en Lote · Mesa de Corte
                    </h3>
                    <span className="rounded-full border border-dashed border-line-diecut bg-accent-soft px-2.5 py-0.5 font-mono text-[10px] font-extrabold uppercase text-accent">
                      Hasta {MAX_ORDER_DESIGNS} diseños
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-secondary">
                    Arrastra varias imágenes aquí o selecciónalas juntas para crear automáticamente
                    una tarjeta troquelada por archivo (PNG, JPG, WEBP o SVG · máx.{" "}
                    {THEME_CONFIG.upload.maxSizeMB} MB c/u).
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={isSubmitting || remainingDesignSlots === 0}
                  onClick={() => batchInputRef.current?.click()}
                  leftIcon={<UploadCloud className="h-4 w-4" />}
                >
                  Seleccionar varias imágenes
                </Button>
              </div>
            </div>
          </div>

          {/* 2. Floating / Top "Configuración Rápida (Aplicar a todos)" Bar when 2+ designs are loaded */}
          <AnimatePresence initial={false}>
            {fields.length >= 2 && (
              <motion.div
                key="quick-batch-config-bar"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="sticky top-20 z-20 rounded-sticker border-2 border-dashed border-line-diecut bg-surface-card/95 p-3.5 shadow-sticker backdrop-blur-md"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-line-subtle pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink">
                      <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="font-display text-xs font-extrabold uppercase tracking-wider text-ink-primary">
                      Configuración Rápida (Aplicar a todos)
                    </span>
                    <span className="hidden rounded-full border border-line-subtle bg-surface-elevated px-2 py-0.5 font-mono text-[10px] font-semibold text-ink-muted sm:inline-block">
                      Rellena las {fields.length} tarjetas de golpe y ajusta cualquiera después
                    </span>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={isSubmitting}
                    onClick={handleApplyQuickPresetToAll}
                    leftIcon={<Check className="h-3.5 w-3.5" />}
                  >
                    Aplicar a todos los diseños
                  </Button>
                </div>

                <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-12">
                  {/* Material */}
                  <div className="lg:col-span-3">
                    <label className="mb-1 block font-mono text-[10px] font-bold uppercase text-ink-secondary">
                      Material
                    </label>
                    <select
                      aria-label="Material para aplicar a todos los diseños"
                      disabled={isSubmitting}
                      value={quickPreset.material}
                      onChange={(e) =>
                        setQuickPreset((prev) => ({
                          ...prev,
                          material: e.target.value as StickerMaterial,
                        }))
                      }
                      className="h-9 w-full rounded-md border border-line-subtle bg-surface-elevated px-2.5 text-xs font-bold text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {materialOptions.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Sub-option if Vinilo Brillo */}
                  {quickPreset.material === "Vinilo Brillo" && (
                    <div className="lg:col-span-2">
                      <label className="mb-1 block font-mono text-[10px] font-bold uppercase text-accent">
                        Modalidad Brillo
                      </label>
                      <select
                        aria-label="Modalidad Vinilo Brillo para aplicar a todos"
                        disabled={isSubmitting}
                        value={quickPreset.vinylGlossMode}
                        onChange={(e) =>
                          setQuickPreset((prev) => ({
                            ...prev,
                            vinylGlossMode: e.target.value as VinylGlossMode,
                          }))
                        }
                        className="h-9 w-full rounded-md border border-dashed border-line-diecut bg-accent-soft/65 px-2.5 text-xs font-bold text-ink-primary focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {THEME_CONFIG.vinylGlossModes.map((mode) => (
                          <option key={mode.value} value={mode.value}>
                            {mode.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Forma */}
                  <div
                    className={
                      quickPreset.material === "Vinilo Brillo" ? "lg:col-span-2" : "lg:col-span-3"
                    }
                  >
                    <label className="mb-1 block font-mono text-[10px] font-bold uppercase text-ink-secondary">
                      Forma
                    </label>
                    <select
                      aria-label="Forma para aplicar a todos los diseños"
                      disabled={isSubmitting}
                      value={quickPreset.shape}
                      onChange={(e) =>
                        setQuickPreset((prev) => ({
                          ...prev,
                          shape: e.target.value as StickerShape,
                        }))
                      }
                      className="h-9 w-full rounded-md border border-line-subtle bg-surface-elevated px-2.5 text-xs font-bold text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {THEME_CONFIG.shapes.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Medida (Circular diameter vs Non-Circular mode + measure) */}
                  <div
                    className={
                      quickPreset.material === "Vinilo Brillo" ? "lg:col-span-3" : "lg:col-span-4"
                    }
                  >
                    <label className="mb-1 block font-mono text-[10px] font-bold uppercase text-ink-secondary">
                      Medida
                    </label>
                    {quickPreset.shape === "Circular" ? (
                      <input
                        type="number"
                        step="0.1"
                        min="0.5"
                        max="500"
                        disabled={isSubmitting}
                        aria-label="Diámetro en cm para aplicar a todos"
                        placeholder="Ø Diámetro cm (ej. 5)"
                        value={quickPreset.diameterCm}
                        onChange={(e) =>
                          setQuickPreset((prev) => ({ ...prev, diameterCm: e.target.value }))
                        }
                        className="h-9 w-full rounded-md border border-line-subtle bg-surface-elevated px-2.5 font-mono text-xs font-bold text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <select
                          aria-label="Modo de medida para aplicar a todos"
                          disabled={isSubmitting}
                          value={quickPreset.sizeMode}
                          onChange={(e) =>
                            setQuickPreset((prev) => ({
                              ...prev,
                              sizeMode: e.target.value as StickerSizeMode,
                            }))
                          }
                          className="h-9 w-28 shrink-0 rounded-md border border-line-subtle bg-surface-elevated px-1.5 font-mono text-[11px] font-bold text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="both">Alto×Ancho</option>
                          <option value="height_only">Solo Alto</option>
                          <option value="width_only">Solo Ancho</option>
                        </select>

                        {quickPreset.sizeMode === "height_only" ? (
                          <input
                            type="number"
                            step="0.1"
                            min="0.5"
                            max="500"
                            disabled={isSubmitting}
                            aria-label="Alto en cm para aplicar a todos"
                            placeholder="Alto cm (ej. 7)"
                            value={quickPreset.heightCm}
                            onChange={(e) =>
                              setQuickPreset((prev) => ({ ...prev, heightCm: e.target.value }))
                            }
                            className="h-9 min-w-0 flex-1 rounded-md border border-line-subtle bg-surface-elevated px-2.5 font-mono text-xs font-bold text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        ) : quickPreset.sizeMode === "width_only" ? (
                          <input
                            type="number"
                            step="0.1"
                            min="0.5"
                            max="500"
                            disabled={isSubmitting}
                            aria-label="Ancho en cm para aplicar a todos"
                            placeholder="Ancho cm (ej. 7)"
                            value={quickPreset.widthCm}
                            onChange={(e) =>
                              setQuickPreset((prev) => ({ ...prev, widthCm: e.target.value }))
                            }
                            className="h-9 min-w-0 flex-1 rounded-md border border-line-subtle bg-surface-elevated px-2.5 font-mono text-xs font-bold text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        ) : (
                          <input
                            type="text"
                            disabled={isSubmitting}
                            aria-label="Alto x Ancho para aplicar a todos"
                            placeholder="Ej. 5x5 cm"
                            value={quickPreset.dimensions}
                            onChange={(e) =>
                              setQuickPreset((prev) => ({ ...prev, dimensions: e.target.value }))
                            }
                            className="h-9 min-w-0 flex-1 rounded-md border border-line-subtle bg-surface-elevated px-2.5 font-mono text-xs font-bold text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Cantidad */}
                  <div className="lg:col-span-2">
                    <label className="mb-1 block font-mono text-[10px] font-bold uppercase text-ink-secondary">
                      Cantidad
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      disabled={isSubmitting}
                      aria-label="Cantidad por diseño para aplicar a todos"
                      placeholder="Ej. 50"
                      value={quickPreset.quantity}
                      onChange={(e) =>
                        setQuickPreset((prev) => ({
                          ...prev,
                          quantity: Number(e.target.value),
                        }))
                      }
                      className="h-9 w-full rounded-md border border-line-subtle bg-surface-elevated px-2.5 font-mono text-xs font-bold tabular-nums text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {itemsRootError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-state-critical-bg bg-state-critical-bg px-4 py-3 text-xs font-semibold text-state-critical-ink"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{itemsRootError}</span>
            </div>
          )}

          {/* Dynamic Design Cards Stack */}
          <div className={viewMode === "compact" ? "space-y-3" : "space-y-5"}>
            <AnimatePresence initial={false}>
              {fields.map((field, index) => {
                const currentItem = watchedItems[index] ?? createDefaultDesignItem();
                const currentErrors = Array.isArray(errors.items)
                  ? errors.items[index]
                  : undefined;

                return (
                  <DesignItemCard
                    key={field.id}
                    fieldId={field.id}
                    index={index}
                    totalCount={fields.length}
                    totalOrderVariantsCount={totalFlattenedDesigns}
                    value={currentItem}
                    materials={materialOptions}
                    itemErrors={currentErrors}
                    previewUrl={resolveItemPreviewUrl(field.id, currentItem)}
                    isActivePreview={activePreviewIndex === index}
                    compact={viewMode === "compact"}
                    disabled={isSubmitting}
                    register={register}
                    setValue={setValue}
                    onImageChange={(file) => handleDesignImageChange(field.id, index, file)}
                    onActivatePreview={() => setActivePreviewIndex(index)}
                    onRemove={() => handleRemoveDesign(field.id, index)}
                  />
                );
              })}
            </AnimatePresence>
          </div>

          {/* Clear "+ Agregar otro diseño" & Batch Upload Action Row */}
          <div className="grid grid-cols-1 gap-2.5 pt-1 sm:grid-cols-2">
            <Button
              type="button"
              variant="dieCut"
              size="lg"
              fullWidth
              disabled={isSubmitting || totalFlattenedDesigns >= MAX_ORDER_DESIGNS}
              onClick={handleAddDesign}
              className="h-12 border-2 text-sm font-bold"
            >
              + Agregar otro diseño vacío
            </Button>

            <Button
              type="button"
              variant="outline"
              size="lg"
              fullWidth
              disabled={isSubmitting || totalFlattenedDesigns >= MAX_ORDER_DESIGNS}
              onClick={() => batchInputRef.current?.click()}
              leftIcon={<UploadCloud className="h-4 w-4 text-accent" />}
              className="h-12 text-sm font-bold"
            >
              Subir más imágenes en lote ({remainingDesignSlots} disponibles)
            </Button>
          </div>

          {totalFlattenedDesigns >= MAX_ORDER_DESIGNS && (
            <p className="text-center font-mono text-[11px] text-ink-muted">
              Alcanzaste el límite máximo de {MAX_ORDER_DESIGNS} diseños/variantes por pedido.
            </p>
          )}
        </section>

        {/* Final Submit Card */}
        <StickerCard
          id="paso-confirmar"
          tone="featured"
          padding="md"
          className="scroll-mt-24 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line-subtle bg-surface-elevated/60 px-4 py-3 text-xs">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-secondary">
              <span>
                <strong className="text-ink-primary">{fields.length}</strong>{" "}
                {fields.length === 1 ? "archivo de diseño" : "archivos de diseño"}
              </span>
              {totalFlattenedDesigns > fields.length && (
                <>
                  <span aria-hidden="true" className="text-line-strong">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono font-bold text-accent">
                    <Scissors className="h-3 w-3" aria-hidden="true" />
                    {totalFlattenedDesigns} medidas en total (1 sola subida por archivo)
                  </span>
                </>
              )}
              <span aria-hidden="true" className="text-line-strong">
                ·
              </span>
              <span className="font-mono font-bold tabular-nums text-ink-primary">
                {totalUnits.toLocaleString()} stickers en total
              </span>
            </div>
            {watched.delivery_date && (
              <span className="font-mono text-[11px] font-semibold tabular-nums text-accent">
                Entrega: {watched.delivery_date} · {watched.delivery_hour}
              </span>
            )}
          </div>

          {serverError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-state-critical-bg bg-state-critical-bg px-4 py-3 text-xs font-semibold text-state-critical-ink"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{serverError}</span>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-dashed border-line-subtle pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] leading-relaxed text-ink-muted">
              Al enviar, aceptas que revisemos la calidad de impresión y línea de corte de tus
              archivos en preprensa a 300 DPI.
            </p>
            <Button
              type="submit"
              size="lg"
              loading={isSubmitting}
              rightIcon={<Send className="h-4 w-4" />}
              className="w-full sm:w-auto sm:min-w-[260px]"
            >
              {isSubmitting
                ? THEME_CONFIG.copy.publicPortal.submittingLabel
                : totalFlattenedDesigns > 1
                ? `Enviar pedido (${totalFlattenedDesigns} diseños · ${totalUnits.toLocaleString()} uds.)`
                : THEME_CONFIG.copy.publicPortal.submitLabel}
            </Button>
          </div>
        </StickerCard>
      </form>

      {/* Right Column: Sticky Interactive Live Sticker Preview */}
      <aside
        aria-label="Simulador en vivo de tus stickers"
        className="lg:sticky lg:top-24 lg:col-span-5 xl:col-span-4"
      >
        <LiveStickerPreview
          designs={previewEntries}
          activeIndex={activePreviewIndex}
          onSelectDesign={(idx) => {
            setActivePreviewIndex(idx);
            const el = document.getElementById(`diseno-${idx + 1}`);
            el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }}
          referralName={watched.referral_name || ""}
          deliveryDate={watched.delivery_date}
          deliveryHour={watched.delivery_hour}
        />
      </aside>
    </div>
  );
};
