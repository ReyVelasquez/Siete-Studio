import React, { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  CalendarClock,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  History,
  Image as ImageIcon,
  Layers,
  Loader2,
  MessageCircle,
  Play,
  Save,
  Scissors,
  Scroll,
  Sparkles,
  Trash2,
  Wallet,
} from "lucide-react";
import { THEME_CONFIG, formatCurrency } from "@/config/theme.config";
import { PrepressStatusBadge, getPrepressStatusMeta } from "@/components/orders/PrepressStatusBadge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { StickerBadge } from "@/components/ui/StickerBadge";
import {
  resolveDesignMeasureSpec,
  salesUpdateSchema,
  type SalesUpdateFormValues,
} from "@/schemas/order.schema";
import { imageProcessingService } from "@/services/imageProcessing.service";
import { ordersService } from "@/services/orders.service";
import type { OrderDesignItemResponse, OrderItem } from "@/types/order";
import { formatDateTime } from "@/utils/date";
import { useToast } from "@/hooks/useToast";

interface OrderDetailModalProps {
  order: OrderItem | null;
  onClose: () => void;
  onUpdated: (updatedOrder: OrderItem) => void;
  onDeleted?: (orderId: string) => void;
}

export const OrderDetailModal: React.FC<OrderDetailModalProps> = ({
  order,
  onClose,
  onUpdated,
  onDeleted,
}) => {
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [artworkNaturalSize, setArtworkNaturalSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [selectedItemIndex, setSelectedItemIndex] = useState(0);
  const [previewVariant, setPreviewVariant] = useState<"original" | "enhanced">("original");
  const [loadingImage, setLoadingImage] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [exportingProduction, setExportingProduction] = useState<"eps" | "pdf" | "zip" | null>(
    null
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [startingWork, setStartingWork] = useState(false);

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
    setConfirmDelete(false);
    setSelectedItemIndex(0);
    setPreviewVariant("original");
    reset({
      total_price: order.total_price,
      advance_payment: order.advance_payment,
      payment_method: order.payment_method,
      status: order.status,
      notes: order.notes ?? "",
    });
  }, [order, reset]);

  const designItems = useMemo<OrderDesignItemResponse[]>(() => {
    if (!order) return [];
    if (order.items && order.items.length > 0) {
      return [...order.items].sort((a, b) => a.position - b.position);
    }
    return [
      {
        id: "",
        position: 1,
        material: order.material,
        vinyl_gloss_mode: order.vinyl_gloss_mode,
        shape: order.shape,
        diameter_cm: order.diameter_cm,
        size_mode: order.size_mode ?? null,
        height_cm: order.height_cm ?? null,
        width_cm: order.width_cm ?? null,
        dimensions: order.dimensions,
        size_display: order.size_display,
        quantity: order.quantity,
        image: order.image,
        prepress_status: "pendiente",
      },
    ];
  }, [order]);

  const activeDesignItem =
    designItems[selectedItemIndex] ?? designItems[0] ?? null;

  const hasEnhancedForActive = Boolean(
    activeDesignItem?.enhanced_storage_path ||
      activeDesignItem?.has_enhanced_image ||
      activeDesignItem?.prepress_status === "mejorado" ||
      activeDesignItem?.prepress_status === "troquelado" ||
      activeDesignItem?.prepress_status === "listo_pliego"
  );

  // Automatically prefer enhanced artwork when selecting a design that has it
  useEffect(() => {
    setPreviewVariant(hasEnhancedForActive ? "enhanced" : "original");
  }, [activeDesignItem?.id, selectedItemIndex, hasEnhancedForActive]);

  useEffect(() => {
    if (!order) {
      setImageUrl(null);
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;
    const effectiveVariant =
      previewVariant === "enhanced" && hasEnhancedForActive ? "enhanced" : "original";

    const loadImage = async () => {
      setLoadingImage(true);
      setArtworkNaturalSize(null);
      try {
        const url =
          activeDesignItem && activeDesignItem.id
            ? await ordersService.fetchOrderItemImageObjectUrl(
                order.id,
                activeDesignItem.id,
                effectiveVariant
              )
            : await ordersService.fetchOrderImageObjectUrl(order.id, effectiveVariant);
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
  }, [order, activeDesignItem, previewVariant, hasEnhancedForActive]);

  if (!order) return null;

  const activeImageMeta = activeDesignItem?.image ?? order.image;
  const activeMaterial = activeDesignItem?.material ?? order.material;
  const activeVinylGlossMode = activeDesignItem
    ? activeDesignItem.vinyl_gloss_mode
    : order.vinyl_gloss_mode;
  const activeShape = activeDesignItem?.shape ?? order.shape;
  const activeSizeDisplay =
    activeDesignItem?.size_display ||
    activeDesignItem?.dimensions ||
    order.size_display ||
    order.dimensions ||
    "—";
  const activeResolvedMeasure = resolveDesignMeasureSpec({
    shape: activeShape,
    diameter_cm: activeDesignItem?.diameter_cm ?? order.diameter_cm,
    size_mode: activeDesignItem?.size_mode ?? order.size_mode ?? undefined,
    height_cm: activeDesignItem?.height_cm ?? order.height_cm ?? undefined,
    width_cm: activeDesignItem?.width_cm ?? order.width_cm ?? undefined,
    dimensions: activeDesignItem?.dimensions ?? order.dimensions ?? activeSizeDisplay,
    artworkSize: artworkNaturalSize,
  });
  const activeQuantity = activeDesignItem?.quantity ?? order.quantity;
  const totalOrderQuantity = order.total_quantity ?? order.quantity;
  const isMultiDesign = designItems.length > 1;

  const prepressSummary = designItems.reduce(
    (acc, item) => {
      const meta = getPrepressStatusMeta(item.prepress_status);
      const hasEnhanced = Boolean(
        item.enhanced_storage_path ||
          item.has_enhanced_image ||
          meta.key === "mejorado" ||
          meta.key === "troquelado" ||
          meta.key === "listo_pliego"
      );
      const hasDieCut = Boolean(
        item.die_cut_eps_path ||
          item.die_cut_anchors_json ||
          meta.key === "troquelado" ||
          meta.key === "listo_pliego"
      );
      const hasEps = Boolean(
        item.die_cut_eps_path || meta.key === "troquelado" || meta.key === "listo_pliego"
      );

      if (hasEnhanced) acc.enhanced += 1;
      if (hasDieCut) acc.dieCut += 1;
      if (hasEps) acc.epsReady += 1;
      if (meta.key !== "pendiente" || hasEnhanced || hasDieCut) acc.progressed += 1;
      return acc;
    },
    { enhanced: 0, dieCut: 0, epsReady: 0, progressed: 0 }
  );
  const prepressProgressPct =
    designItems.length > 0
      ? Math.round((prepressSummary.progressed / designItems.length) * 100)
      : 0;

  const isRollOrder =
    designItems.some((it) => it.vinyl_gloss_mode === "En rollo") ||
    order.vinyl_gloss_mode === "En rollo";

  const unenhancedDesignItems = designItems.filter((item) => {
    const meta = getPrepressStatusMeta(item.prepress_status);
    return !Boolean(
      item.enhanced_storage_path ||
        item.has_enhanced_image ||
        meta.key === "mejorado" ||
        meta.key === "troquelado" ||
        meta.key === "listo_pliego"
    );
  });

  const watchedTotal = Number(watch("total_price")) || 0;
  const watchedAdvance = Number(watch("advance_payment")) || 0;
  const computedBalance = Math.max(0, Number((watchedTotal - watchedAdvance).toFixed(2)));

  const buildLabUrl = (basePath: "/dashboard/image-enhancer" | "/dashboard/die-cut", itemId?: string) => {
    const qs = new URLSearchParams({ orderId: order.id });
    if (itemId) qs.set("itemId", itemId);
    return `${basePath}?${qs.toString()}`;
  };

  const openEnhancerForDesign = (item: OrderDesignItemResponse) => {
    const targetItemId = item.id || undefined;
    onClose();
    navigate(buildLabUrl("/dashboard/image-enhancer", targetItemId), {
      state: { order, itemId: targetItemId },
    });
  };

  const openDieCutForDesign = (item: OrderDesignItemResponse) => {
    const targetItemId = item.id || undefined;
    onClose();
    navigate(buildLabUrl("/dashboard/die-cut", targetItemId), {
      state: { order, itemId: targetItemId },
    });
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      if (isMultiDesign && activeDesignItem?.id) {
        await ordersService.downloadOrderItemImageFile(
          order.id,
          activeDesignItem.id,
          activeDesignItem.image.safe_filename ||
            `${order.order_number}-item-${activeDesignItem.position}.png`
        );
      } else {
        await ordersService.downloadOrderImageFile(
          order.id,
          order.image.safe_filename || `${order.order_number}.png`
        );
      }
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

  const handleExportProduction = async (format: "eps" | "pdf") => {
    setExportingProduction(format);
    try {
      const suffix =
        format === "pdf"
          ? "mesas_separadas.pdf"
          : isRollOrder
          ? "carriles_rollo.eps"
          : "hoja_produccion.eps";
      const res = await imageProcessingService.exportOrderProduction(
        order.id,
        format,
        `${order.order_number}_${suffix}`
      );
      pushToast({
        title:
          format === "pdf"
            ? "Mesas separadas (.PDF) exportadas"
            : isRollOrder
            ? "Carriles en rollo (.EPS) exportados"
            : "Trabajo en 1 hoja (.EPS) exportado",
        description: `${res.filename} (${prepressSummary.enhanced}/${designItems.length} con arte mejorado).`,
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: `No se pudo exportar producción (.${format.toUpperCase()})`,
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setExportingProduction(null);
    }
  };

  const handleExportOrderZip = async () => {
    setExportingProduction("zip");
    try {
      const res = await imageProcessingService.exportOrderZip(
        order.id,
        `${order.order_number}_preprensa.zip`
      );
      pushToast({
        title: `Paquete .ZIP descargado (${res.packagedItems || prepressSummary.epsReady}/${
          res.totalItems || designItems.length
        } diseños)`,
        description: res.filename,
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: "No se pudo descargar el paquete .ZIP",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setExportingProduction(null);
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

  const handleDeleteOrder = async () => {
    setDeleting(true);
    try {
      await ordersService.deleteOrder(order.id);
      pushToast({
        title: `Pedido ${order.order_number} eliminado`,
        description: "Registro e imagen asociados eliminados correctamente.",
        variant: "success",
      });
      onDeleted?.(order.id);
      onClose();
    } catch (err) {
      pushToast({
        title: "No se pudo eliminar el pedido",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleStartWork = async () => {
    setStartingWork(true);
    try {
      let targetOrder = order;
      if (order.status === "Pendiente") {
        targetOrder = await ordersService.updateOrderSales(order.id, {
          status: "En Diseño",
        });
        onUpdated(targetOrder);
        pushToast({
          title: `Trabajo ${targetOrder.order_number} iniciado`,
          description: "Estado actualizado a En Diseño · Abriendo procesamiento de calidad.",
          variant: "success",
        });
      }
      const focusItemId = activeDesignItem?.id || undefined;
      onClose();
      const qs = new URLSearchParams({ orderId: targetOrder.id });
      if (focusItemId) qs.set("itemId", focusItemId);
      navigate(`/dashboard/image-enhancer?${qs.toString()}`, {
        state: { order: targetOrder, itemId: focusItemId },
      });
    } catch (err) {
      pushToast({
        title: "No se pudo iniciar el trabajo",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setStartingWork(false);
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
      maxWidthClass="max-w-5xl"
    >
      {/* Prominent Start Work -> Image Quality & CMYK Production Action Bar */}
      {order.status !== "Cancelado" && (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-dashed border-line-diecut bg-accent-soft/55 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-ink shadow-sm">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-bold text-ink-primary">
                {order.status === "Pendiente"
                  ? "Listo para iniciar producción"
                  : `Trabajo en curso (${order.status})`}
              </p>
              <p className="mt-0.5 text-xs text-ink-secondary">
                {order.status === "Pendiente"
                  ? "Inicia el trabajo (pasa automáticamente a En Diseño) y abre su imagen directa en el Laboratorio de Calidad y CMYK."
                  : "Abre directamente el arte de este trabajo para ajustar resolución, brillo/contraste y tintas CMYK."}
              </p>
            </div>
          </div>
          <Button
            type="button"
            size="md"
            loading={startingWork}
            onClick={() => void handleStartWork()}
            leftIcon={<Play className="h-4 w-4" />}
            className="shrink-0"
          >
            {order.status === "Pendiente" ? "Comenzar trabajo" : "Procesar imagen"}
          </Button>
        </div>
      )}

      {/* Prepress Progress & Per-Design Quick-Access Roster */}
      <section
        aria-label="Diseños del pedido y progreso de preprensa"
        className="mb-5 rounded-xl border border-line-subtle bg-surface-elevated/55 p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dashed border-line-subtle pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-display text-xs font-extrabold uppercase tracking-wider text-ink-primary">
                {isMultiDesign
                  ? `Diseños y Preprensa (${designItems.length} diseños · ${totalOrderQuantity.toLocaleString()} uds.)`
                  : "Progreso de Preprensa del Diseño"}
              </h3>
              <p className="text-[11px] text-ink-muted">
                Selecciona un diseño para inspeccionarlo o ábrelo directo en Calidad/CMYK o Troquelado.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle bg-surface-card px-2.5 py-1 font-mono text-[11px] font-bold tabular-nums text-ink-secondary">
              <CheckCircle2 className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              {prepressSummary.progressed}/{designItems.length} avanzados
            </span>
            {isMultiDesign && (
              <div
                aria-label={`Avance de preprensa ${prepressProgressPct}%`}
                className="hidden h-2 w-24 overflow-hidden rounded-full bg-surface-subtle sm:block"
              >
                <div
                  className="h-full rounded-full bg-accent transition-all duration-base ease-studio"
                  style={{ width: `${prepressProgressPct}%` }}
                />
              </div>
            )}
          </div>
        </div>

        <ul className="mt-3 space-y-2" role="list">
          {designItems.map((item, idx) => {
            const isSelected = idx === selectedItemIndex;
            const formattedPos = String(item.position).padStart(2, "0");

            return (
              <li
                key={item.id || `primary-${idx}`}
                className={`flex flex-col gap-3 rounded-lg border p-3 transition-colors duration-fast ease-studio sm:flex-row sm:items-center sm:justify-between ${
                  isSelected
                    ? "border-line-diecut bg-surface-card shadow-xs ring-1 ring-line-diecut/30"
                    : "border-line-subtle bg-surface-card/70 hover:border-line-strong hover:bg-surface-card"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedItemIndex(idx)}
                  aria-pressed={isSelected}
                  className="flex min-w-0 flex-1 items-start gap-2.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-extrabold ${
                      isSelected
                        ? "bg-accent text-accent-ink"
                        : "bg-surface-elevated text-ink-secondary"
                    }`}
                  >
                    {formattedPos}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-ink-primary">
                        Diseño #{item.position}
                      </span>
                      <span className="rounded border border-dashed border-line-diecut/70 bg-accent-soft/60 px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink-primary">
                        {item.size_display || item.dimensions || "—"}
                      </span>
                      <PrepressStatusBadge status={item.prepress_status} size="xs" />
                      {item.die_cut_eps_path && (
                        <span className="rounded-xs border border-line-subtle bg-surface-elevated px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-ink-secondary">
                          .EPS listo
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-ink-muted">
                      {item.material}
                      {item.vinyl_gloss_mode ? ` (${item.vinyl_gloss_mode})` : ""} · {item.shape} ·{" "}
                      {item.size_display || item.dimensions} · {item.quantity.toLocaleString()} uds.
                    </p>
                  </div>
                </button>

                {order.status !== "Cancelado" && (
                  <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openEnhancerForDesign(item)}
                      leftIcon={<Sparkles className="h-3.5 w-3.5" />}
                    >
                      Mejorar este diseño
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="dieCut"
                      onClick={() => openDieCutForDesign(item)}
                      leftIcon={<Scissors className="h-3.5 w-3.5" />}
                    >
                      Troquelar este diseño
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* Smart Production Export for Orders with 2 or more designs */}
        {isMultiDesign && order.status !== "Cancelado" && (
          <div className="mt-4 space-y-3 rounded-lg border border-dashed border-line-diecut bg-surface-card p-3.5">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 font-display text-xs font-extrabold uppercase tracking-wider text-ink-primary">
                    {isRollOrder ? (
                      <Scroll className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    ) : (
                      <Layers className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    )}
                    <span>Exportación Conjunta de Producción ({designItems.length} diseños)</span>
                  </span>
                  <span className="rounded-full border border-line-diecut/60 bg-accent-soft/70 px-2 py-0.5 font-mono text-[10px] font-extrabold text-accent">
                    {isRollOrder ? "Modo detectado: En rollo" : "Modo detectado: Hoja / Corte"}
                  </span>
                </div>
                <p className="text-xs text-ink-secondary">
                  {isRollOrder
                    ? "Pedido con diseños en rollo: exporta mesas separadas (.PDF listo para Illustrator) o carriles en .EPS."
                    : "Trabajo en hoja/corte: exporta todos los diseños del pedido impuestos en 1 hoja de producción (.EPS)."}
                </p>
              </div>

              {/* Pre-Download Summary Counters */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold tabular-nums ${
                    prepressSummary.enhanced === designItems.length
                      ? "border-preflight-ok-border bg-preflight-ok-bg text-preflight-ok-ink"
                      : "border-preflight-warn-border bg-preflight-warn-bg text-preflight-warn-ink"
                  }`}
                >
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  <span>
                    Arte mejorado: {prepressSummary.enhanced}/{designItems.length}
                  </span>
                </span>

                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold tabular-nums ${
                    prepressSummary.dieCut === designItems.length
                      ? "border-preflight-ok-border bg-preflight-ok-bg text-preflight-ok-ink"
                      : "border-line-subtle bg-surface-elevated text-ink-secondary"
                  }`}
                >
                  <Scissors className="h-3 w-3 text-accent" aria-hidden="true" />
                  <span>
                    Troquel guardado: {prepressSummary.dieCut}/{designItems.length}
                  </span>
                </span>
              </div>
            </div>

            {/* Warning before downloading if any design still uses the original unenhanced artwork */}
            {unenhancedDesignItems.length > 0 && (
              <div
                role="status"
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-preflight-warn-border bg-preflight-warn-bg/85 px-3 py-2 text-xs text-preflight-warn-ink"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    <strong>Advertencia antes de descargar:</strong>{" "}
                    {unenhancedDesignItems.length === 1
                      ? `El diseño #${unenhancedDesignItems[0].position} todavía usa el arte original sin mejorar.`
                      : `Los diseños ${unenhancedDesignItems
                          .map((it) => `#${it.position}`)
                          .join(", ")} todavía usan el arte original sin mejorar.`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => openEnhancerForDesign(unenhancedDesignItems[0])}
                  className="shrink-0 font-mono text-[11px] font-extrabold underline hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Mejorar en Lab CMYK →
                </button>
              </div>
            )}

            {/* Smart Production Export Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {!isRollOrder ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    loading={exportingProduction === "eps"}
                    onClick={() => void handleExportProduction("eps")}
                    leftIcon={<Download className="h-3.5 w-3.5" />}
                  >
                    Exportar trabajo en 1 hoja (.EPS)
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={prepressSummary.epsReady === 0}
                    loading={exportingProduction === "zip"}
                    onClick={() => void handleExportOrderZip()}
                    leftIcon={<Archive className="h-3.5 w-3.5" />}
                  >
                    .ZIP (1 EPS por diseño) ({prepressSummary.epsReady}/{designItems.length})
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    loading={exportingProduction === "pdf"}
                    onClick={() => void handleExportProduction("pdf")}
                    leftIcon={<FileText className="h-3.5 w-3.5" />}
                  >
                    Exportar mesas separadas (.PDF listo para Illustrator)
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    loading={exportingProduction === "eps"}
                    onClick={() => void handleExportProduction("eps")}
                    leftIcon={<Scroll className="h-3.5 w-3.5 text-accent" />}
                  >
                    Exportar carriles en .EPS
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={prepressSummary.epsReady === 0}
                    loading={exportingProduction === "zip"}
                    onClick={() => void handleExportOrderZip()}
                    leftIcon={<Archive className="h-3.5 w-3.5" />}
                  >
                    .ZIP (1 EPS por diseño) ({prepressSummary.epsReady}/{designItems.length})
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Artwork & Technical Print Specs */}
        <div className="space-y-4 lg:col-span-5">
          <div className="die-cut-zone overflow-hidden rounded-xl p-3">
            {hasEnhancedForActive && (
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                  Vista del arte · Diseño #{activeDesignItem?.position ?? 1}
                </span>
                <div
                  role="group"
                  aria-label="Versión del arte"
                  className="inline-flex items-center rounded-md border border-line-subtle bg-surface-elevated p-0.5"
                >
                  <button
                    type="button"
                    aria-pressed={previewVariant === "original"}
                    onClick={() => setPreviewVariant("original")}
                    className={`rounded-xs px-2 py-0.5 font-mono text-[10px] font-bold transition-colors ${
                      previewVariant === "original"
                        ? "bg-surface-card text-ink-primary shadow-xs"
                        : "text-ink-muted hover:text-ink-primary"
                    }`}
                  >
                    Original
                  </button>
                  <button
                    type="button"
                    aria-pressed={previewVariant === "enhanced"}
                    onClick={() => setPreviewVariant("enhanced")}
                    className={`rounded-xs px-2 py-0.5 font-mono text-[10px] font-bold transition-colors ${
                      previewVariant === "enhanced"
                        ? "bg-accent text-accent-ink shadow-xs"
                        : "text-ink-muted hover:text-ink-primary"
                    }`}
                  >
                    Mejorado
                  </button>
                </div>
              </div>
            )}

            <div className="bg-transparency-grid flex h-56 items-center justify-center overflow-hidden rounded-lg border border-line-subtle p-3">
              {loadingImage ? (
                <div className="flex flex-col items-center gap-2 text-ink-muted">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="text-xs">Cargando arte seguro...</span>
                </div>
              ) : imageUrl ? (
                <img
                  src={imageUrl}
                  alt={`Arte del pedido ${order.order_number} · Diseño #${activeDesignItem?.position ?? 1}`}
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    if (el.naturalWidth > 0 && el.naturalHeight > 0) {
                      setArtworkNaturalSize({
                        width: el.naturalWidth,
                        height: el.naturalHeight,
                      });
                    }
                  }}
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
                  {activeImageMeta.original_filename}
                </p>
                <p className="font-mono text-[10px] text-ink-muted">
                  {activeImageMeta.content_type} · {(activeImageMeta.size_bytes / 1024).toFixed(0)}{" "}
                  KB
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
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
          </div>

          <div className="rounded-xl border border-line-subtle bg-surface-elevated/60 p-4 text-xs">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="font-bold uppercase tracking-wider text-ink-secondary">
                {isMultiDesign && activeDesignItem
                  ? `Ficha Técnica · Diseño #${activeDesignItem.position}`
                  : "Ficha Técnica"}
              </span>
              <StickerBadge status={order.status} />
            </div>

            <dl className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-muted">Preprensa</dt>
                <dd>
                  <PrepressStatusBadge status={activeDesignItem?.prepress_status} size="xs" />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-muted">Material</dt>
                <dd className="text-right font-semibold text-ink-primary">
                  {activeMaterial}
                  {activeVinylGlossMode ? ` · ${activeVinylGlossMode}` : ""}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-muted">Forma</dt>
                <dd className="font-semibold text-ink-primary">{activeShape}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-muted">Medida</dt>
                <dd className="text-right font-mono font-bold text-ink-primary">
                  <span>{activeSizeDisplay}</span>
                  {activeResolvedMeasure.proportionalHint && (
                    <span className="mt-0.5 block text-[10px] font-semibold text-accent">
                      {activeResolvedMeasure.livePreviewText}
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-muted">
                  {isMultiDesign ? "Cantidad (este diseño)" : "Cantidad"}
                </dt>
                <dd className="font-mono font-bold text-ink-primary">
                  {activeQuantity.toLocaleString()} uds.
                </dd>
              </div>
              {isMultiDesign && (
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-muted">Total del pedido</dt>
                  <dd className="font-mono font-bold text-accent">
                    {designItems.length} diseños · {totalOrderQuantity.toLocaleString()} uds.
                  </dd>
                </div>
              )}
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
                <p role="alert" className="text-xs font-semibold text-ink-primary">
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

          {/* Relational Audit Trail: Status History & Payments */}
          {((order.status_history && order.status_history.length > 0) ||
            (order.payments && order.payments.length > 0)) && (
            <div className="rounded-xl border border-line-subtle bg-surface-elevated/50 p-4 text-xs">
              <div className="mb-2.5 flex items-center gap-1.5 font-bold uppercase tracking-wider text-ink-secondary">
                <History className="h-3.5 w-3.5 text-accent" />
                <span>Bitácora Relacional (Estados y Abonos)</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {order.status_history && order.status_history.length > 0 && (
                  <ul className="space-y-1.5">
                    {order.status_history.slice(0, 4).map((h) => (
                      <li key={h.id} className="rounded bg-surface-card px-2.5 py-1.5">
                        <span className="font-bold text-ink-primary">{h.new_status}</span>
                        <span className="block font-mono text-[10px] text-ink-muted">
                          {formatDateTime(h.changed_at)} · {h.changed_by || "Sistema"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {order.payments && order.payments.length > 0 && (
                  <ul className="space-y-1.5">
                    {order.payments.slice(0, 4).map((p) => (
                      <li key={p.id} className="rounded bg-surface-card px-2.5 py-1.5">
                        <span className="font-mono font-bold text-accent">
                          +{formatCurrency(p.amount)} ({p.payment_method})
                        </span>
                        <span className="block font-mono text-[10px] text-ink-muted">
                          {formatDateTime(p.recorded_at)} · {p.recorded_by || "Sistema"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Actions bar including CRUD Delete with two-step confirmation */}
          <div className="flex flex-col gap-3 border-t border-line-subtle pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="inverted"
                    loading={deleting}
                    onClick={handleDeleteOrder}
                    leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                  >
                    Confirmar borrado
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmDelete(false)}
                  >
                    No
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDelete(true)}
                  leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                >
                  Eliminar pedido
                </Button>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2.5 sm:flex-row">
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
          </div>
        </form>
      </div>
    </Modal>
  );
};
