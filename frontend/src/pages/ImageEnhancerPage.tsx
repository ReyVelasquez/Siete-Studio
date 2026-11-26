import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Brush,
  CheckCircle2,
  Download,
  Droplets,
  Eraser,
  FileImage,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  Loader2,
  Printer,
  RefreshCw,
  RotateCcw,
  Ruler,
  Save,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  SunMedium,
  Upload,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { pageTransitionVariants } from "@/config/animations";
import {
  BeforeAfterSlider,
  type CanvasViewMode,
} from "@/components/image-processing/BeforeAfterSlider";
import { CmykTelemetryBar } from "@/components/image-processing/CmykTelemetryBar";
import { RetouchInpaintModal } from "@/components/image-processing/RetouchInpaintModal";
import { StickerDropzone } from "@/components/orders/StickerDropzone";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { StickerBadge } from "@/components/ui/StickerBadge";
import { useToast } from "@/hooks/useToast";
import { imageProcessingService } from "@/services/imageProcessing.service";
import { ordersService } from "@/services/orders.service";
import type {
  BatchEnhanceItemProgress,
  BatchEnhanceProgress,
  EnhanceAdjustments,
  EnhanceImageResult,
  EnhanceOutputFormat,
  OrderDesignItemResponse,
  OrderItem,
  PreflightDpiLevel,
  PreflightDpiTelemetry,
  PrepressStatus,
} from "@/types/order";

const DEFAULT_ADJUSTMENTS: EnhanceAdjustments = {
  target_dpi: 300,
  upscale_factor: 1.0,
  denoise_strength: 0,
  sharpen_strength: 0,
  auto_contrast: false,
  remove_background: false,
  bg_mode: "smart_subject",
  bg_tolerance: 28,
  bg_feather: 1,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  gamma: 1.0,
  cyan: 0,
  magenta: 0,
  yellow: 0,
  black: 0,
  ink_limit_percent: 300,
};

interface StudioPreset {
  id: string;
  label: string;
  subtitle: string;
  values: Partial<EnhanceAdjustments>;
}

const PRINT_PRESETS: StudioPreset[] = [
  {
    id: "original",
    label: "Original",
    subtitle: "Neutro 1x",
    values: DEFAULT_ADJUSTMENTS,
  },
  {
    id: "vinyl_vibrant",
    label: "Vinilo Vibrante",
    subtitle: "2x · Nitidez +30",
    values: {
      ...DEFAULT_ADJUSTMENTS,
      upscale_factor: 2.0,
      target_dpi: 300,
      denoise_strength: 15,
      sharpen_strength: 30,
      brightness: 5,
      contrast: 12,
      saturation: 15,
      ink_limit_percent: 300,
    },
  },
  {
    id: "dtf_uv",
    label: "DTF UV Contraste",
    subtitle: "2x · C+18 · K+8%",
    values: {
      ...DEFAULT_ADJUSTMENTS,
      upscale_factor: 2.0,
      target_dpi: 300,
      sharpen_strength: 40,
      contrast: 18,
      saturation: 10,
      black: 8,
      ink_limit_percent: 300,
    },
  },
  {
    id: "ink_saver",
    label: "Ahorro / Papel",
    subtitle: "TAC 260% · K-6%",
    values: {
      ...DEFAULT_ADJUSTMENTS,
      target_dpi: 300,
      brightness: 8,
      contrast: 6,
      black: -6,
      ink_limit_percent: 260,
    },
  },
];

function getRecommendedPresetForMaterial(material: string): StudioPreset {
  switch (material) {
    case "Vinilo Brillo":
      return PRINT_PRESETS[1];
    case "DTF UV":
      return PRINT_PRESETS[2];
    case "Hojas Adhesivas":
      return PRINT_PRESETS[3];
    case "Vinilo Mate":
      return {
        id: "vinyl_matte",
        label: "Vinilo Mate",
        subtitle: "2x · Brillo +8 · Gamma 1.10 · TAC 280%",
        values: {
          ...DEFAULT_ADJUSTMENTS,
          upscale_factor: 2.0,
          target_dpi: 300,
          denoise_strength: 15,
          sharpen_strength: 25,
          brightness: 8,
          contrast: 10,
          gamma: 1.1,
          ink_limit_percent: 280,
        },
      };
    case "Transparente":
      return {
        id: "transparent",
        label: "Vinilo Transparente",
        subtitle: "2x · Contraste +15 · Saturación +18",
        values: {
          ...DEFAULT_ADJUSTMENTS,
          upscale_factor: 2.0,
          target_dpi: 300,
          sharpen_strength: 30,
          contrast: 15,
          saturation: 18,
          ink_limit_percent: 300,
        },
      };
    default:
      return PRINT_PRESETS[1];
  }
}

function normalizeOrderItems(order: OrderItem | null): OrderDesignItemResponse[] {
  if (!order) return [];
  if (order.items && order.items.length > 0) {
    return [...order.items].sort((a, b) => a.position - b.position);
  }
  return [
    {
      id: `legacy-${order.id}-1`,
      position: 1,
      material: order.material,
      vinyl_gloss_mode: order.vinyl_gloss_mode,
      shape: order.shape,
      diameter_cm: order.diameter_cm,
      dimensions: order.dimensions,
      size_display: order.size_display,
      quantity: order.quantity,
      image: order.image,
    },
  ];
}

function supportsWhiteInkMaterial(material?: string | null): boolean {
  if (!material) return false;
  const normalized = material.trim().toLowerCase();
  return (
    normalized === "transparente" ||
    normalized === "dtf uv" ||
    normalized.includes("transparente") ||
    normalized.includes("dtf uv")
  );
}

function parseRequestedCm(
  item: OrderDesignItemResponse | null,
  sourceDims?: { width: number; height: number } | null
): { widthCm: number; heightCm: number } | null {
  if (!item) return null;
  if (item.shape === "Circular" && item.diameter_cm != null) {
    const d = Number(item.diameter_cm);
    if (Number.isFinite(d) && d > 0) {
      return { widthCm: d, heightCm: d };
    }
  }
  const raw = (item.dimensions || item.size_display || "").trim();
  const aspect =
    sourceDims && sourceDims.width > 0 && sourceDims.height > 0
      ? sourceDims.width / sourceDims.height
      : 1;

  if (item.size_mode === "height_only" && item.height_cm && item.height_cm > 0) {
    const h = Number(item.height_cm);
    return {
      widthCm: Math.max(0.1, Math.round(h * aspect * 100) / 100),
      heightCm: h,
    };
  }
  if (item.size_mode === "width_only" && item.width_cm && item.width_cm > 0) {
    const w = Number(item.width_cm);
    return {
      widthCm: w,
      heightCm: Math.max(0.1, Math.round((w / aspect) * 100) / 100),
    };
  }

  if (!raw) return null;

  const rectMatch = /(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)/.exec(raw);
  if (rectMatch) {
    const heightCm = Number(rectMatch[1].replace(",", "."));
    const widthCm = Number(rectMatch[2].replace(",", "."));
    if (Number.isFinite(widthCm) && Number.isFinite(heightCm) && widthCm > 0 && heightCm > 0) {
      return { widthCm, heightCm };
    }
  }

  const heightOnlyMatch = /^\s*alto\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i.exec(raw);
  if (heightOnlyMatch) {
    const h = Number(heightOnlyMatch[1].replace(",", "."));
    if (Number.isFinite(h) && h > 0) {
      return {
        widthCm: Math.max(0.1, Math.round(h * aspect * 100) / 100),
        heightCm: h,
      };
    }
  }

  const widthOnlyMatch = /^\s*ancho\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i.exec(raw);
  if (widthOnlyMatch) {
    const w = Number(widthOnlyMatch[1].replace(",", "."));
    if (Number.isFinite(w) && w > 0) {
      return {
        widthCm: w,
        heightCm: Math.max(0.1, Math.round((w / aspect) * 100) / 100),
      };
    }
  }

  if (item.shape === "Circular" || raw.includes("Ø")) {
    const circleMatch = /(\d+(?:[.,]\d+)?)/.exec(raw);
    if (circleMatch) {
      const d = Number(circleMatch[1].replace(",", "."));
      if (Number.isFinite(d) && d > 0) {
        return { widthCm: d, heightCm: d };
      }
    }
  }

  return null;
}

const MAX_ENHANCER_OUTPUT_DIM_PX = 4096;

function computePreflightDpi(params: {
  item: OrderDesignItemResponse | null;
  sourceDims: { width: number; height: number } | null;
  outputDims: { width: number; height: number } | null;
  upscaleFactor: number;
  viewingOriginal: boolean;
}): PreflightDpiTelemetry | null {
  const requested = parseRequestedCm(params.item, params.sourceDims);
  const src = params.sourceDims;
  if (!requested || !src || src.width <= 0 || src.height <= 0) return null;

  const isProjected = !params.viewingOriginal && !params.outputDims;
  let outW = src.width;
  let outH = src.height;

  if (!params.viewingOriginal) {
    if (params.outputDims && params.outputDims.width > 0 && params.outputDims.height > 0) {
      outW = params.outputDims.width;
      outH = params.outputDims.height;
    } else {
      const cappedScale = Math.min(
        params.upscaleFactor,
        MAX_ENHANCER_OUTPUT_DIM_PX / Math.max(src.width, src.height)
      );
      const effectiveScale = Math.max(1, cappedScale);
      outW = Math.round(src.width * effectiveScale);
      outH = Math.round(src.height * effectiveScale);
    }
  }

  const measureAxisDpi = (pxW: number, pxH: number, cmW: number, cmH: number) => {
    const alignedOrientation = (pxW >= pxH) === (cmW >= cmH);
    const targetW = alignedOrientation ? cmW : cmH;
    const targetH = alignedOrientation ? cmH : cmW;
    const dpiX = (pxW * 2.54) / targetW;
    const dpiY = (pxH * 2.54) / targetH;
    return { dpiX, dpiY, effective: Math.min(dpiX, dpiY) };
  };

  const srcDpi = measureAxisDpi(src.width, src.height, requested.widthCm, requested.heightCm);
  const outDpi = measureAxisDpi(outW, outH, requested.widthCm, requested.heightCm);

  const effectiveDpi = Math.round(outDpi.effective);
  const sourceDpi = Math.round(srcDpi.effective);
  const level: PreflightDpiLevel =
    effectiveDpi >= 300 ? "optimal" : effectiveDpi >= 150 ? "warning" : "critical";
  const recommendedUpscale: 1 | 2 | 4 =
    level === "optimal" ? 1 : level === "warning" ? 2 : 4;

  return {
    effectiveDpi,
    effectiveDpiX: Math.round(outDpi.dpiX),
    effectiveDpiY: Math.round(outDpi.dpiY),
    sourceDpi,
    requestedWidthCm: requested.widthCm,
    requestedHeightCm: requested.heightCm,
    outputWidthPx: outW,
    outputHeightPx: outH,
    level,
    recommendedUpscale,
    isProjected,
  };
}

interface PrepressBadgeMeta {
  label: string;
  classes: string;
  dotClasses: string;
  spinning?: boolean;
}

function getPrepressStatusMeta(
  status: PrepressStatus | "batch_processing" | "batch_error" | undefined
): PrepressBadgeMeta {
  switch (status) {
    case "batch_processing":
      return {
        label: "Procesando",
        classes: "border-sborg-emerald/70 bg-accent-soft text-accent",
        dotClasses: "bg-accent",
        spinning: true,
      };
    case "batch_error":
      return {
        label: "Error",
        classes: "border-preflight-crit-border/70 bg-preflight-crit-bg text-preflight-crit-ink",
        dotClasses: "bg-preflight-crit-dot",
      };
    case "listo_pliego":
    case "print_ready":
    case "Listo":
      return {
        label: "Listo pliego",
        classes: "border-preflight-ok-border bg-preflight-ok-bg text-preflight-ok-ink",
        dotClasses: "bg-preflight-ok-dot",
      };
    case "troquelado":
    case "die_cut_ready":
    case "Troquelado":
      return {
        label: "Troquelado",
        classes: "border-dashed border-line-diecut bg-accent-soft text-ink-primary",
        dotClasses: "bg-accent",
      };
    case "mejorado":
    case "enhanced":
    case "Mejorado":
      return {
        label: "Mejorado",
        classes: "border-preflight-ok-border/80 bg-preflight-ok-bg text-preflight-ok-ink",
        dotClasses: "bg-preflight-ok-dot",
      };
    case "in_progress":
    case "En Proceso":
      return {
        label: "En preprensa",
        classes: "border-line-diecut/60 bg-state-info-bg text-state-info-ink",
        dotClasses: "bg-accent",
      };
    case "pendiente":
    case "pending":
    case "Pendiente":
    default:
      return {
        label: "Pendiente",
        classes: "border-dashed border-line-strong/70 bg-surface-elevated text-ink-muted",
        dotClasses: "bg-line-strong",
      };
  }
}

interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (val: number) => void;
}

const SliderControl: React.FC<SliderControlProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
}) => {
  const formatted =
    step < 1 ? value.toFixed(2) : value > 0 && min < 0 ? `+${value}` : String(value);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-ink-secondary">{label}</span>
        <span className="rounded-xs border border-line-subtle bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-ink-primary">
          {formatted}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-elevated accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
};

interface RetouchedItemEntry {
  file: File;
  previewUrl: string;
}

export const ImageEnhancerPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { pushToast } = useToast();

  const urlOrderId = searchParams.get("orderId") || "";
  const urlItemId = searchParams.get("itemId") || "";
  const stateOrder = (location.state as { order?: OrderItem } | null)?.order ?? null;

  const [sourceMode, setSourceMode] = useState<"order" | "upload">("order");
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>(urlOrderId);
  const [selectedItemId, setSelectedItemId] = useState<string>(urlItemId);
  const [activeOrderDetail, setActiveOrderDetail] = useState<OrderItem | null>(
    stateOrder && stateOrder.id === urlOrderId ? stateOrder : null
  );

  // Standalone upload state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadOriginalUrl, setUploadOriginalUrl] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<EnhanceImageResult | null>(null);
  const [uploadAdjustments, setUploadAdjustments] =
    useState<EnhanceAdjustments>(DEFAULT_ADJUSTMENTS);
  const [uploadRetouched, setUploadRetouched] = useState<RetouchedItemEntry | null>(null);

  // Per-design-item non-destructive caches (keyed by item.id)
  const [originalUrlsByItemId, setOriginalUrlsByItemId] = useState<Record<string, string>>({});
  const [serverEnhancedUrlsByItemId, setServerEnhancedUrlsByItemId] = useState<
    Record<string, string>
  >({});
  const [resultsByItemId, setResultsByItemId] = useState<Record<string, EnhanceImageResult>>({});
  const [adjustmentsByItemId, setAdjustmentsByItemId] = useState<
    Record<string, EnhanceAdjustments>
  >({});
  const [retouchedByItemId, setRetouchedByItemId] = useState<Record<string, RetouchedItemEntry>>(
    {}
  );
  const [localPrepressStatusByItemId, setLocalPrepressStatusByItemId] = useState<
    Record<string, PrepressStatus>
  >({});
  const [dimsByItemId, setDimsByItemId] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const [loadingThumbnails, setLoadingThumbnails] = useState(false);

  // Studio UI & inspection controls
  const [canvasViewMode, setCanvasViewMode] = useState<CanvasViewMode>("split");
  const [whiteInkPreview, setWhiteInkPreview] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [savingToOrder, setSavingToOrder] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<EnhanceOutputFormat | null>(null);
  const [autoPreview, setAutoPreview] = useState(true);
  const [activeTab, setActiveTab] = useState<"quality" | "cmyk" | "retouch" | "save">("quality");
  const [retouchModalOpen, setRetouchModalOpen] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchEnhanceProgress | null>(null);

  const debounceRef = useRef<number | null>(null);
  const enhanceSeqRef = useRef(0);
  const batchAbortRef = useRef<AbortController | null>(null);
  const retouchedUrlsRef = useRef<Set<string>>(new Set());
  const filmstripRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const lastAutoPreviewKeyRef = useRef<string>("");

  const orderItems = useMemo(() => normalizeOrderItems(activeOrderDetail), [activeOrderDetail]);
  const isMultiDesignOrder = sourceMode === "order" && orderItems.length >= 2;

  const activeDesignItem = useMemo<OrderDesignItemResponse | null>(() => {
    if (sourceMode !== "order" || orderItems.length === 0) return null;
    return orderItems.find((it) => it.id === selectedItemId) ?? orderItems[0];
  }, [sourceMode, orderItems, selectedItemId]);

  const activeItemId = activeDesignItem?.id ?? "";
  const activeMaterial = activeDesignItem?.material ?? activeOrderDetail?.material ?? "";
  const activeSizeDisplay = activeDesignItem?.size_display ?? activeOrderDetail?.size_display ?? "";
  const supportsWhiteInk = sourceMode === "order" && supportsWhiteInkMaterial(activeMaterial);

  const adjustments = useMemo<EnhanceAdjustments>(() => {
    if (sourceMode === "upload") return uploadAdjustments;
    if (activeItemId && adjustmentsByItemId[activeItemId]) {
      return adjustmentsByItemId[activeItemId];
    }
    return DEFAULT_ADJUSTMENTS;
  }, [sourceMode, uploadAdjustments, activeItemId, adjustmentsByItemId]);

  const activeRetouched =
    sourceMode === "upload"
      ? uploadRetouched
      : activeItemId
      ? retouchedByItemId[activeItemId] ?? null
      : null;

  const activeResult =
    sourceMode === "upload"
      ? uploadResult
      : activeItemId
      ? resultsByItemId[activeItemId] ?? null
      : null;

  const activeOriginalUrl =
    sourceMode === "upload"
      ? uploadOriginalUrl
      : activeItemId
      ? originalUrlsByItemId[activeItemId] ?? null
      : null;

  const activeEnhancedUrl =
    sourceMode === "upload"
      ? uploadResult?.preview_data_url ?? null
      : activeItemId
      ? resultsByItemId[activeItemId]?.preview_data_url ??
        serverEnhancedUrlsByItemId[activeItemId] ??
        null
      : null;

  const hasSource =
    Boolean(activeRetouched?.file) ||
    (sourceMode === "order" && Boolean(selectedOrderId && activeItemId)) ||
    (sourceMode === "upload" && Boolean(uploadedFile));

  const isBatchRunning = Boolean(batchProgress?.running);

  // Revoke any retouched Object URLs on unmount
  useEffect(() => {
    const urls = retouchedUrlsRef.current;
    return () => {
      batchAbortRef.current?.abort();
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  // Revoke standalone upload preview URL on unmount
  useEffect(() => {
    return () => {
      if (uploadOriginalUrl) URL.revokeObjectURL(uploadOriginalUrl);
    };
  }, [uploadOriginalUrl]);

  const clearAllRetouchedForOrder = useCallback(() => {
    setRetouchedByItemId((prev) => {
      Object.values(prev).forEach((entry) => {
        URL.revokeObjectURL(entry.previewUrl);
        retouchedUrlsRef.current.delete(entry.previewUrl);
      });
      return {};
    });
  }, []);

  const clearActiveRetouched = useCallback(() => {
    if (sourceMode === "upload") {
      setUploadRetouched((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev.previewUrl);
          retouchedUrlsRef.current.delete(prev.previewUrl);
        }
        return null;
      });
      return;
    }
    if (!activeItemId) return;
    setRetouchedByItemId((prev) => {
      const target = prev[activeItemId];
      if (!target) return prev;
      URL.revokeObjectURL(target.previewUrl);
      retouchedUrlsRef.current.delete(target.previewUrl);
      const next = { ...prev };
      delete next[activeItemId];
      return next;
    });
  }, [sourceMode, activeItemId]);

  const setActiveAdjustments = useCallback(
    (updater: EnhanceAdjustments | ((prev: EnhanceAdjustments) => EnhanceAdjustments)) => {
      if (sourceMode === "upload") {
        setUploadAdjustments((prev) =>
          typeof updater === "function" ? updater(prev) : updater
        );
        return;
      }
      if (!activeItemId) return;
      setAdjustmentsByItemId((prev) => {
        const current = prev[activeItemId] ?? DEFAULT_ADJUSTMENTS;
        const nextVal = typeof updater === "function" ? updater(current) : updater;
        return { ...prev, [activeItemId]: nextVal };
      });
    },
    [sourceMode, activeItemId]
  );

  // Sync URL query params (?orderId=...&itemId=...) only when the URL actually changes
  const prevUrlParamsRef = useRef({ orderId: urlOrderId, itemId: urlItemId });
  useEffect(() => {
    const prev = prevUrlParamsRef.current;
    if (urlOrderId === prev.orderId && urlItemId === prev.itemId) return;
    prevUrlParamsRef.current = { orderId: urlOrderId, itemId: urlItemId };

    if (urlOrderId && urlOrderId !== selectedOrderId) {
      batchAbortRef.current?.abort();
      setBatchProgress(null);
      clearAllRetouchedForOrder();
      setSourceMode("order");
      setSelectedOrderId(urlOrderId);
      setSelectedItemId(urlItemId);
    } else if (urlItemId && urlItemId !== selectedItemId && sourceMode === "order") {
      setSelectedItemId(urlItemId);
    }
  }, [urlOrderId, urlItemId, selectedOrderId, selectedItemId, sourceMode, clearAllRetouchedForOrder]);

  // Keep selectedItemId valid whenever activeOrderDetail's items update
  useEffect(() => {
    if (sourceMode !== "order" || orderItems.length === 0) return;
    const exists = orderItems.some((it) => it.id === selectedItemId);
    if (!exists) {
      setSelectedItemId(orderItems[0].id);
    }
  }, [sourceMode, orderItems, selectedItemId]);

  // Reset White Ink preview automatically when switching to a non-transparent/non-DTF-UV substrate
  useEffect(() => {
    if (!supportsWhiteInk && whiteInkPreview) {
      setWhiteInkPreview(false);
    }
  }, [supportsWhiteInk, whiteInkPreview]);

  // Load admin orders list for switcher
  useEffect(() => {
    let active = true;
    ordersService
      .listAdminOrders()
      .then((res) => {
        if (!active) return;
        setOrders(res.items);
        if (!urlOrderId && !selectedOrderId && res.items.length > 0) {
          setSelectedOrderId(res.items[0].id);
        }
      })
      .catch(() => {
        // Standalone upload remains available even if orders fail to load
      });
    return () => {
      active = false;
    };
  }, [urlOrderId, selectedOrderId]);

  // Resolve full active order metadata
  useEffect(() => {
    if (sourceMode !== "order" || !selectedOrderId) {
      setActiveOrderDetail(null);
      return;
    }

    const fromList = orders.find((o) => o.id === selectedOrderId);
    if (fromList) {
      setActiveOrderDetail(fromList);
      return;
    }

    let cancelled = false;
    ordersService
      .getOrderById(selectedOrderId)
      .then((ord) => {
        if (!cancelled) setActiveOrderDetail(ord);
      })
      .catch(() => {
        if (!cancelled) setActiveOrderDetail(null);
      });

    return () => {
      cancelled = true;
    };
  }, [sourceMode, selectedOrderId, orders]);

  // Stable structural signature of order item IDs so saving/batching enhanced versions never flickers or revokes original thumbnails
  const orderItemIdsKey = useMemo(
    () => orderItems.map((it) => it.id).join(","),
    [orderItems]
  );

  // Reset per-order caches when switching to a different order
  const prevOrderIdRef = useRef<string>("");
  useEffect(() => {
    if (prevOrderIdRef.current !== selectedOrderId) {
      prevOrderIdRef.current = selectedOrderId;
      batchAbortRef.current?.abort();
      setBatchProgress(null);
      setResultsByItemId({});
      setAdjustmentsByItemId({});
      setLocalPrepressStatusByItemId({});
      setDimsByItemId({});
      setWhiteInkPreview(false);
      setCanvasViewMode("split");
      lastAutoPreviewKeyRef.current = "";
      clearAllRetouchedForOrder();
    }
  }, [selectedOrderId, clearAllRetouchedForOrder]);

  // Fetch original (and server-enhanced if present) artwork Object URLs for every item in the active order
  useEffect(() => {
    if (sourceMode !== "order" || !selectedOrderId || orderItems.length === 0) {
      setOriginalUrlsByItemId({});
      setServerEnhancedUrlsByItemId({});
      return;
    }

    let cancelled = false;
    const createdUrls: string[] = [];
    setLoadingThumbnails(true);

    const loadAll = async () => {
      const nextOriginals: Record<string, string> = {};
      const nextEnhanced: Record<string, string> = {};

      await Promise.all(
        orderItems.map(async (item) => {
          try {
            const origUrl = await imageProcessingService.fetchOrderItemArtworkUrl(
              selectedOrderId,
              item.id,
              "original"
            );
            if (cancelled) {
              URL.revokeObjectURL(origUrl);
              return;
            }
            createdUrls.push(origUrl);
            nextOriginals[item.id] = origUrl;

            // Measure natural pixel dimensions eagerly so Filmstrip DPI indicators work for every card
            const probe = new Image();
            probe.onload = () => {
              if (!cancelled && probe.naturalWidth > 0 && probe.naturalHeight > 0) {
                setDimsByItemId((prev) => ({
                  ...prev,
                  [item.id]: { width: probe.naturalWidth, height: probe.naturalHeight },
                }));
              }
            };
            probe.src = origUrl;
          } catch {
            // Card falls back cleanly to placeholder icon
          }

          if (item.enhanced_storage_path || item.has_enhanced_image || item.enhanced_image) {
            try {
              const enhUrl = await imageProcessingService.fetchOrderItemArtworkUrl(
                selectedOrderId,
                item.id,
                "enhanced"
              );
              if (cancelled) {
                URL.revokeObjectURL(enhUrl);
                return;
              }
              createdUrls.push(enhUrl);
              nextEnhanced[item.id] = enhUrl;
            } catch {
              // Enhanced version optional
            }
          }
        })
      );

      if (!cancelled) {
        setOriginalUrlsByItemId(nextOriginals);
        setServerEnhancedUrlsByItemId(nextEnhanced);
        setLoadingThumbnails(false);
      }
    };

    void loadAll();

    return () => {
      cancelled = true;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode, selectedOrderId, orderItemIdsKey]);

  const handleSelectDesignItem = (item: OrderDesignItemResponse) => {
    setSelectedItemId(item.id);
    if (selectedOrderId) {
      setSearchParams({ orderId: selectedOrderId, itemId: item.id }, { replace: true });
    }
    const hasEnh = Boolean(
      resultsByItemId[item.id] || serverEnhancedUrlsByItemId[item.id] || item.has_enhanced_image
    );
    if (!hasEnh && canvasViewMode === "enhanced") {
      setCanvasViewMode("split");
    }
  };

  const handleUploadedFileChange = (file: File | null) => {
    if (uploadOriginalUrl) {
      URL.revokeObjectURL(uploadOriginalUrl);
    }
    clearActiveRetouched();
    setUploadedFile(file);
    setUploadResult(null);
    setUploadOriginalUrl(file ? URL.createObjectURL(file) : null);
  };

  const handleApplyRetouchedFile = (file: File) => {
    const url = URL.createObjectURL(file);
    retouchedUrlsRef.current.add(url);

    if (sourceMode === "upload") {
      setUploadRetouched((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev.previewUrl);
          retouchedUrlsRef.current.delete(prev.previewUrl);
        }
        return { file, previewUrl: url };
      });
      setUploadResult(null);
    } else if (activeItemId) {
      setRetouchedByItemId((prev) => {
        const existing = prev[activeItemId];
        if (existing) {
          URL.revokeObjectURL(existing.previewUrl);
          retouchedUrlsRef.current.delete(existing.previewUrl);
        }
        return { ...prev, [activeItemId]: { file, previewUrl: url } };
      });
      setResultsByItemId((prev) => {
        const next = { ...prev };
        delete next[activeItemId];
        return next;
      });
    }

    lastAutoPreviewKeyRef.current = "";
    pushToast({
      title: "Retoque aplicado al laboratorio",
      description: "Ajusta brillo, contraste, CMYK o pasa directo al troquelador.",
      variant: "success",
    });
  };

  const runEnhancement = useCallback(
    async (opts: EnhanceAdjustments, silentSuccess = false) => {
      if (sourceMode === "order" && (!selectedOrderId || !activeItemId) && !activeRetouched?.file) {
        return;
      }
      if (sourceMode === "upload" && !uploadedFile && !activeRetouched?.file) {
        return;
      }

      const seq = ++enhanceSeqRef.current;
      const targetMode = sourceMode;
      const targetOrderId = selectedOrderId;
      const targetItemId = activeItemId;
      const retouchFile = activeRetouched?.file ?? null;

      setProcessing(true);
      try {
        const res = retouchFile
          ? await imageProcessingService.enhanceUploadedImage(retouchFile, opts)
          : targetMode === "order"
          ? await imageProcessingService.enhanceOrderImage(
              targetOrderId,
              opts,
              targetItemId,
              "original"
            )
          : await imageProcessingService.enhanceUploadedImage(uploadedFile!, opts);

        if (targetMode === "upload") {
          setUploadResult(res);
        } else if (targetItemId) {
          setResultsByItemId((prev) => ({ ...prev, [targetItemId]: res }));
          setDimsByItemId((prev) =>
            prev[targetItemId]
              ? prev
              : {
                  ...prev,
                  [targetItemId]: { width: res.original_width, height: res.original_height },
                }
          );
          setLocalPrepressStatusByItemId((prev) =>
            prev[targetItemId] && prev[targetItemId] !== "pending"
              ? prev
              : { ...prev, [targetItemId]: "in_progress" }
          );
        }

        if (!silentSuccess && seq === enhanceSeqRef.current) {
          setCanvasViewMode((prev) => (prev === "original" ? "split" : prev));
          pushToast({
            title: "Imagen procesada con OpenCV + CMYK",
            description: `${res.output_width}×${res.output_height} px · ${res.target_dpi} DPI (${res.processing_time_ms} ms)`,
            variant: "success",
          });
        }
      } catch (err) {
        if (seq === enhanceSeqRef.current) {
          pushToast({
            title: "No se pudo procesar la imagen",
            description: err instanceof Error ? err.message : undefined,
            variant: "error",
          });
        }
      } finally {
        if (seq === enhanceSeqRef.current) {
          setProcessing(false);
        }
      }
    },
    [sourceMode, selectedOrderId, activeItemId, activeRetouched, uploadedFile, pushToast]
  );

  // Debounced auto-preview when enabled, source is ready, and batch is not running
  const autoPreviewSignature = useMemo(
    () =>
      JSON.stringify({
        sourceMode,
        selectedOrderId,
        activeItemId,
        hasRetouch: Boolean(activeRetouched?.file),
        hasUpload: Boolean(uploadedFile),
        adjustments,
      }),
    [sourceMode, selectedOrderId, activeItemId, activeRetouched, uploadedFile, adjustments]
  );

  useEffect(() => {
    if (!autoPreview || !hasSource || isBatchRunning) return;
    if (lastAutoPreviewKeyRef.current === autoPreviewSignature) return;

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      lastAutoPreviewKeyRef.current = autoPreviewSignature;
      void runEnhancement(adjustments, true);
    }, 360);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [autoPreview, hasSource, isBatchRunning, autoPreviewSignature, adjustments, runEnhancement]);

  const updateAdj = <K extends keyof EnhanceAdjustments>(
    key: K,
    value: EnhanceAdjustments[K]
  ) => {
    setActiveAdjustments((prev) => ({ ...prev, [key]: value }));
  };

  const handleQuickUpscale = (factor: 2 | 4) => {
    const next: EnhanceAdjustments = {
      ...adjustments,
      upscale_factor: factor,
      target_dpi: Math.max(300, adjustments.target_dpi),
    };
    setActiveAdjustments(next);
    if (canvasViewMode === "original") {
      setCanvasViewMode("split");
    }
    if (!autoPreview && hasSource) {
      void runEnhancement(next, false);
    }
    pushToast({
      title: `Escalado Lanczos-4 aplicado (${factor}x)`,
      description: "Recalculando nitidez y DPI efectivos para preprensa.",
      variant: "info",
    });
  };

  const handleApplyPreset = (preset: StudioPreset) => {
    const next = { ...DEFAULT_ADJUSTMENTS, ...preset.values };
    setActiveAdjustments(next);
    if (canvasViewMode === "original") {
      setCanvasViewMode("split");
    }
    if (!autoPreview && hasSource) {
      void runEnhancement(next, false);
    }
  };

  const handleReset = () => {
    setActiveAdjustments(DEFAULT_ADJUSTMENTS);
  };

  const handleSaveToOrder = async (
    advanceStatus?: "En Diseño" | "En Impresión" | "Troquelado" | "Listo"
  ) => {
    if (sourceMode !== "order" || !selectedOrderId || !activeItemId) return;
    const key = advanceStatus || "keep";
    setSavingToOrder(key);
    try {
      const updated = await imageProcessingService.saveEnhancedToOrder(
        selectedOrderId,
        adjustments,
        advanceStatus,
        activeRetouched?.file ?? null,
        activeItemId
      );
      setActiveOrderDetail(updated);
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));

      // Non-destructive update: keep original URL intact and store enhanced artifact
      if (activeResult?.preview_data_url) {
        setServerEnhancedUrlsByItemId((prev) => ({
          ...prev,
          [activeItemId]: activeResult.preview_data_url,
        }));
      }
      setLocalPrepressStatusByItemId((prev) => ({
        ...prev,
        [activeItemId]:
          advanceStatus === "En Impresión" || advanceStatus === "Listo"
            ? "print_ready"
            : "enhanced",
      }));
      clearActiveRetouched();

      const designTag = isMultiDesignOrder && activeDesignItem ? ` · Diseño #${activeDesignItem.position}` : "";
      pushToast({
        title: `Arte guardado en ${updated.order_number}${designTag}`,
        description: advanceStatus
          ? `Versión mejorada guardada (original preservado) · Estado: ${updated.status}.`
          : "Versión mejorada guardada de forma no destructiva; puedes alternar Original ↔ Mejorado.",
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: "No se pudo guardar en el trabajo",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setSavingToOrder(null);
    }
  };

  /** Sequential non-blocking batch application of current adjustments across all order items. */
  const handleRunBatchEnhance = async (targetItems?: OrderDesignItemResponse[]) => {
    if (sourceMode !== "order" || !selectedOrderId) return;
    const itemsToProcess = targetItems && targetItems.length > 0 ? targetItems : orderItems;
    if (itemsToProcess.length === 0) return;

    batchAbortRef.current?.abort();
    const controller = new AbortController();
    batchAbortRef.current = controller;

    const adjustmentsSnapshot: EnhanceAdjustments = { ...adjustments };
    const initialRows: BatchEnhanceItemProgress[] = itemsToProcess.map((it) => ({
      itemId: it.id,
      position: it.position,
      material: it.material,
      sizeDisplay: it.size_display,
      status: "pending",
    }));

    setBatchProgress({
      running: true,
      total: itemsToProcess.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      currentItemId: itemsToProcess[0].id,
      currentPosition: itemsToProcess[0].position,
      cancelled: false,
      items: initialRows,
    });

    const summary = await imageProcessingService.enhanceOrderItemsBatch({
      orderId: selectedOrderId,
      items: itemsToProcess,
      adjustments: adjustmentsSnapshot,
      saveToOrder: true,
      signal: controller.signal,
      onProgress: (ev) => {
        if (ev.status === "done" && ev.enhanced) {
          setResultsByItemId((prev) => ({ ...prev, [ev.item.id]: ev.enhanced! }));
          setAdjustmentsByItemId((prev) => ({ ...prev, [ev.item.id]: adjustmentsSnapshot }));
          setServerEnhancedUrlsByItemId((prev) => ({
            ...prev,
            [ev.item.id]: ev.enhanced!.preview_data_url,
          }));
          setLocalPrepressStatusByItemId((prev) => ({ ...prev, [ev.item.id]: "enhanced" }));
        }

        setBatchProgress((prev) => {
          if (!prev) return prev;
          const updatedItems = prev.items.map((row) =>
            row.itemId === ev.item.id
              ? {
                  ...row,
                  status: ev.status,
                  error: ev.error,
                  processingTimeMs: ev.enhanced?.processing_time_ms,
                }
              : row
          );
          const completed = updatedItems.filter(
            (r) => r.status === "done" || r.status === "error"
          ).length;
          const succeeded = updatedItems.filter((r) => r.status === "done").length;
          const failed = updatedItems.filter((r) => r.status === "error").length;

          return {
            ...prev,
            completed,
            succeeded,
            failed,
            currentItemId: ev.status === "processing" ? ev.item.id : prev.currentItemId,
            currentPosition: ev.status === "processing" ? ev.item.position : prev.currentPosition,
            items: updatedItems,
          };
        });
      },
    });

    if (summary.latestOrder) {
      setActiveOrderDetail(summary.latestOrder);
      setOrders((prev) =>
        prev.map((o) => (o.id === summary.latestOrder!.id ? summary.latestOrder! : o))
      );
    }

    setBatchProgress((prev) =>
      prev
        ? {
            ...prev,
            running: false,
            cancelled: summary.cancelled,
            currentItemId: null,
            currentPosition: null,
          }
        : null
    );

    if (summary.cancelled) {
      pushToast({
        title: "Procesamiento por lotes detenido",
        description: `Se completaron ${summary.succeeded} de ${itemsToProcess.length} diseños.`,
        variant: "info",
      });
    } else if (summary.failed === 0) {
      pushToast({
        title: `Lote completado (${summary.succeeded}/${itemsToProcess.length})`,
        description: "Todos los diseños fueron calibrados y guardados sin sobrescribir originales.",
        variant: "success",
      });
    } else {
      pushToast({
        title: `Lote finalizado con ${summary.failed} error(es)`,
        description: `${summary.succeeded} diseños procesados correctamente. Puedes reintentar los fallidos.`,
        variant: "error",
      });
    }
  };

  const handleCancelBatch = () => {
    batchAbortRef.current?.abort();
  };

  const handleContinueToDieCut = async (forceRemoveBg = false) => {
    if (!hasSource) return;

    const effectiveAdjustments: EnhanceAdjustments = forceRemoveBg
      ? {
          ...adjustments,
          remove_background: true,
          bg_mode: adjustments.bg_mode || "smart_subject",
        }
      : adjustments;

    if (sourceMode === "order" && selectedOrderId && activeItemId) {
      setSavingToOrder("diecut");
      try {
        const updated = await imageProcessingService.saveEnhancedToOrder(
          selectedOrderId,
          effectiveAdjustments,
          "En Diseño",
          activeRetouched?.file ?? null,
          activeItemId
        );
        clearActiveRetouched();
        const itemParam = !activeItemId.startsWith("legacy-") ? `&itemId=${activeItemId}` : "";
        pushToast({
          title: effectiveAdjustments.remove_background
            ? "PNG sin fondo guardado · Abriendo Troquelador"
            : "PNG guardado · Abriendo Troquelador",
          description: `Arte calibrado listo para definir línea de corte en ${updated.order_number}.`,
          variant: "success",
        });
        navigate(`/dashboard/die-cut?orderId=${updated.id}${itemParam}`, {
          state: { order: updated, itemId: activeItemId, dpi: effectiveAdjustments.target_dpi },
        });
      } catch (err) {
        pushToast({
          title: "No se pudo guardar antes de pasar al troquelador",
          description: err instanceof Error ? err.message : undefined,
          variant: "error",
        });
      } finally {
        setSavingToOrder(null);
      }
      return;
    }

    setSavingToOrder("diecut");
    try {
      let dataUrl = activeResult?.preview_data_url || null;
      const sourceFile = activeRetouched?.file || uploadedFile;
      if (
        forceRemoveBg &&
        (!adjustments.remove_background || !activeResult?.has_transparency) &&
        sourceFile
      ) {
        const cleaned = await imageProcessingService.enhanceUploadedImage(
          sourceFile,
          effectiveAdjustments
        );
        dataUrl = cleaned.preview_data_url;
      }

      if (dataUrl) {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const pngFile = new File(
          [blob],
          `${(uploadedFile?.name || "sticker").replace(/\.[^.]+$/, "")}_sin_fondo.png`,
          { type: "image/png" }
        );
        navigate("/dashboard/die-cut", {
          state: { file: pngFile, dpi: effectiveAdjustments.target_dpi },
        });
        return;
      }
    } catch {
      // fallback below
    } finally {
      setSavingToOrder(null);
    }

    navigate("/dashboard/die-cut", {
      state: { file: activeRetouched?.file || uploadedFile, dpi: effectiveAdjustments.target_dpi },
    });
  };

  const handleExport = async (format: EnhanceOutputFormat) => {
    if (!hasSource) return;
    setExportingFormat(format);
    try {
      const designSuffix =
        sourceMode === "order" && isMultiDesignOrder && activeDesignItem
          ? `-D${activeDesignItem.position}`
          : "";
      const base =
        sourceMode === "order"
          ? `${activeOrderDetail?.order_number || "sticker"}${designSuffix}`
          : (uploadedFile?.name || "sticker").replace(/\.[^.]+$/, "");
      const ext = format === "tiff_cmyk" ? ".tif" : format === "jpeg_cmyk" ? ".jpg" : ".png";
      await imageProcessingService.exportEnhancedImage({
        orderId: !activeRetouched?.file && sourceMode === "order" ? selectedOrderId : null,
        itemId: !activeRetouched?.file && sourceMode === "order" ? activeItemId : null,
        file: activeRetouched?.file || (sourceMode === "upload" ? uploadedFile : null),
        adjustments,
        outputFormat: format,
        fallbackFilename: `${base}-${adjustments.target_dpi}dpi${ext}`,
      });
      pushToast({
        title: "Archivo listo para imprenta descargado",
        description:
          format === "tiff_cmyk"
            ? `TIFF CMYK 4 canales a ${adjustments.target_dpi} DPI`
            : format === "jpeg_cmyk"
            ? `JPEG CMYK 4 canales a ${adjustments.target_dpi} DPI`
            : `PNG transparente a ${adjustments.target_dpi} DPI`,
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: "Error al exportar archivo",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setExportingFormat(null);
    }
  };

  const handleMeasuredOriginalDims = useCallback(
    (dims: { width: number; height: number } | null) => {
      if (!dims || sourceMode !== "order" || !activeItemId) return;
      setDimsByItemId((prev) => {
        const curr = prev[activeItemId];
        if (curr && curr.width === dims.width && curr.height === dims.height) return prev;
        return { ...prev, [activeItemId]: dims };
      });
    },
    [sourceMode, activeItemId]
  );

  // Real-time Preflight DPI Telemetry for active design item
  const activePreflight = useMemo<PreflightDpiTelemetry | null>(() => {
    if (sourceMode !== "order" || !activeDesignItem) return null;
    const sourceDims =
      dimsByItemId[activeItemId] ??
      (activeResult
        ? { width: activeResult.original_width, height: activeResult.original_height }
        : null);
    const outputDims = activeResult
      ? { width: activeResult.output_width, height: activeResult.output_height }
      : null;

    return computePreflightDpi({
      item: activeDesignItem,
      sourceDims,
      outputDims,
      upscaleFactor: adjustments.upscale_factor,
      viewingOriginal: canvasViewMode === "original",
    });
  }, [
    sourceMode,
    activeDesignItem,
    activeItemId,
    dimsByItemId,
    activeResult,
    adjustments.upscale_factor,
    canvasViewMode,
  ]);

  const recommendedPreset = useMemo(
    () => (activeMaterial ? getRecommendedPresetForMaterial(activeMaterial) : null),
    [activeMaterial]
  );

  const getEffectiveItemStatus = useCallback(
    (item: OrderDesignItemResponse): PrepressStatus | "batch_processing" | "batch_error" => {
      const batchRow = batchProgress?.items.find((r) => r.itemId === item.id);
      if (batchRow?.status === "processing") return "batch_processing";
      if (batchRow?.status === "error") return "batch_error";

      const localStatus = localPrepressStatusByItemId[item.id];
      if (localStatus) return localStatus;
      if (item.prepress_status) return item.prepress_status;
      if (
        item.enhanced_storage_path ||
        item.has_enhanced_image ||
        item.enhanced_image ||
        serverEnhancedUrlsByItemId[item.id]
      ) {
        return "mejorado";
      }
      if (resultsByItemId[item.id]) return "in_progress";
      return "pendiente";
    },
    [batchProgress, localPrepressStatusByItemId, serverEnhancedUrlsByItemId, resultsByItemId]
  );

  const readyDesignsCount = useMemo(() => {
    return orderItems.filter((it) => {
      const st = getEffectiveItemStatus(it);
      return (
        st === "mejorado" ||
        st === "troquelado" ||
        st === "listo_pliego" ||
        st === "enhanced" ||
        st === "Mejorado" ||
        st === "die_cut_ready" ||
        st === "Troquelado" ||
        st === "print_ready" ||
        st === "Listo"
      );
    }).length;
  }, [orderItems, getEffectiveItemStatus]);

  const failedBatchItems = useMemo(() => {
    if (!batchProgress || batchProgress.running || batchProgress.failed === 0) return [];
    const failedIds = new Set(
      batchProgress.items.filter((r) => r.status === "error").map((r) => r.itemId)
    );
    return orderItems.filter((it) => failedIds.has(it.id));
  }, [batchProgress, orderItems]);

  const handleFilmstripKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (orderItems.length < 2) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = (idx + 1) % orderItems.length;
      handleSelectDesignItem(orderItems[next]);
      filmstripRefs.current[next]?.focus();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prev = (idx - 1 + orderItems.length) % orderItems.length;
      handleSelectDesignItem(orderItems[prev]);
      filmstripRefs.current[prev]?.focus();
    }
  };

  // Preflight Traffic-Light Pill rendered right inside the Darkroom HUD
  const preflightPillNode = useMemo(() => {
    if (sourceMode !== "order" || !activeDesignItem) {
      return (
        <div className="inline-flex items-center gap-2 rounded-full border border-darkroom-line bg-darkroom-surface px-2.5 py-1 font-mono text-[11px] font-bold text-darkroom-ink">
          <span className="h-2 w-2 rounded-full bg-sborg-emerald" aria-hidden="true" />
          <span>Modo Suelto · {adjustments.target_dpi} DPI</span>
        </div>
      );
    }

    if (!activePreflight) {
      return (
        <div className="inline-flex items-center gap-2 rounded-full border border-dashed border-darkroom-line bg-darkroom-surface px-2.5 py-1 font-mono text-[11px] text-darkroom-muted">
          <Ruler className="h-3.5 w-3.5 text-sborg-emerald" aria-hidden="true" />
          <span>Preflight DPI · {activeSizeDisplay || "Midiendo..."}</span>
        </div>
      );
    }

    const tone =
      activePreflight.level === "optimal"
        ? {
            pill: "border-preflight-ok-border bg-preflight-ok-bg text-preflight-ok-ink",
            dot: "bg-preflight-ok-dot",
            tag: "Óptimo",
          }
        : activePreflight.level === "warning"
        ? {
            pill: "border-preflight-warn-border bg-preflight-warn-bg text-preflight-warn-ink",
            dot: "bg-preflight-warn-dot",
            tag: "Media",
          }
        : {
            pill: "border-preflight-crit-border bg-preflight-crit-bg text-preflight-crit-ink",
            dot: "bg-preflight-crit-dot",
            tag: "Baja",
          };

    const showScale2x =
      activePreflight.level === "warning" && adjustments.upscale_factor < 2;
    const showScale4x =
      (activePreflight.level === "critical" && adjustments.upscale_factor < 4) ||
      (activePreflight.level === "warning" &&
        adjustments.upscale_factor >= 2 &&
        adjustments.upscale_factor < 4);

    return (
      <div
        role="status"
        aria-live="polite"
        className={`inline-flex flex-wrap items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-bold shadow-xs ${tone.pill}`}
        title={`DPI efectivos para ${activeSizeDisplay} (${activePreflight.effectiveDpiX}×${activePreflight.effectiveDpiY} DPI · Salida ${activePreflight.outputWidthPx}×${activePreflight.outputHeightPx} px)`}
      >
        <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden="true">
          {activePreflight.level === "critical" && (
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 motion-reduce:animate-none ${tone.dot}`}
            />
          )}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${tone.dot}`} />
        </span>

        <span className="font-mono tabular-nums">
          {activePreflight.effectiveDpi} DPI
        </span>
        <span className="opacity-80">· {tone.tag}</span>
        <span className="hidden font-mono text-[10px] opacity-75 sm:inline">
          ({activeSizeDisplay})
        </span>

        {showScale2x && (
          <button
            type="button"
            onClick={() => handleQuickUpscale(2)}
            className="ml-0.5 inline-flex items-center gap-1 rounded-full border border-current/35 bg-surface-card/85 px-2 py-0.5 font-mono text-[10px] font-extrabold text-ink-primary shadow-xs transition-transform duration-fast ease-studio hover:scale-[1.03] hover:bg-surface-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Zap className="h-3 w-3 text-accent" aria-hidden="true" />
            <span>Escalar 2x</span>
          </button>
        )}

        {showScale4x && (
          <button
            type="button"
            onClick={() => handleQuickUpscale(4)}
            className="ml-0.5 inline-flex items-center gap-1 rounded-full border border-current/35 bg-surface-card/85 px-2 py-0.5 font-mono text-[10px] font-extrabold text-ink-primary shadow-xs transition-transform duration-fast ease-studio hover:scale-[1.03] hover:bg-surface-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Zap className="h-3 w-3 text-accent" aria-hidden="true" />
            <span>
              {activePreflight.level === "critical" ? "Sugerido: Escalar 4x" : "Escalar 4x"}
            </span>
          </button>
        )}

        {activePreflight.level === "critical" && adjustments.upscale_factor >= 4 && (
          <span className="rounded-full bg-surface-card/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-ink-primary">
            Máx 4x · Arte muy pequeño
          </span>
        )}
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode, activeDesignItem, activePreflight, activeSizeDisplay, adjustments.target_dpi, adjustments.upscale_factor]);

  const batchPercent =
    batchProgress && batchProgress.total > 0
      ? Math.round((batchProgress.completed / batchProgress.total) * 100)
      : 0;

  const dieCutModuleHref =
    sourceMode === "order" && selectedOrderId
      ? `/dashboard/die-cut?orderId=${selectedOrderId}${
          activeItemId && !activeItemId.startsWith("legacy-") ? `&itemId=${activeItemId}` : ""
        }`
      : "/dashboard/die-cut";

  return (
    <motion.div
      variants={pageTransitionVariants}
      initial="initial"
      animate="animate"
      className="flex flex-col gap-2 lg:h-[calc(100vh-4rem)] lg:overflow-hidden"
    >
      {/* Slim Top Command Strip */}
      <div className="bg-print-grid shrink-0 rounded-sticker border border-line-subtle bg-surface-card px-3 py-1.5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Link
              to="/dashboard/orders?only_pending=true"
              title="Volver a pedidos pendientes"
              className="inline-flex items-center gap-1 rounded-md border border-line-subtle bg-surface-card px-2 py-1 text-xs font-bold text-ink-secondary shadow-xs transition-colors duration-fast hover:border-line-diecut hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              <span className="hidden sm:inline">Pedidos</span>
            </Link>

            <nav
              aria-label="Cambiar módulo de preprensa"
              className="inline-flex items-center rounded-md border border-line-subtle bg-surface-elevated p-0.5 text-xs font-bold"
            >
              <span
                aria-current="page"
                className="inline-flex items-center gap-1 rounded-sm bg-accent px-2.5 py-1 text-accent-ink shadow-xs"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Calidad</span>
              </span>
              <Link
                to={dieCutModuleHref}
                className="inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-ink-secondary transition-colors duration-fast hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Scissors className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                <span>Troquel</span>
              </Link>
            </nav>

            <div
              role="group"
              aria-label="Origen del arte"
              className="inline-flex rounded-md border border-line-subtle bg-surface-elevated p-0.5 text-[11px] font-bold"
            >
              <button
                type="button"
                aria-pressed={sourceMode === "order"}
                onClick={() => setSourceMode("order")}
                className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  sourceMode === "order"
                    ? "bg-accent text-accent-ink shadow-xs"
                    : "text-ink-secondary hover:text-ink-primary"
                }`}
              >
                <FolderOpen className="h-3 w-3" aria-hidden="true" />
                <span>Pedido ({orders.length})</span>
              </button>
              <button
                type="button"
                aria-pressed={sourceMode === "upload"}
                onClick={() => setSourceMode("upload")}
                className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  sourceMode === "upload"
                    ? "bg-accent text-accent-ink shadow-xs"
                    : "text-ink-secondary hover:text-ink-primary"
                }`}
              >
                <Upload className="h-3 w-3" aria-hidden="true" />
                <span>Suelta</span>
              </button>
            </div>

            {sourceMode === "order" && (
              <select
                aria-label="Seleccionar trabajo o pedido"
                value={selectedOrderId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedOrderId(id);
                  setSelectedItemId("");
                  if (id) setSearchParams({ orderId: id });
                  else setSearchParams({});
                }}
                className="h-7 max-w-[210px] rounded-md border border-line-subtle bg-surface-card px-2 text-xs font-semibold text-ink-primary shadow-xs transition-colors focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring sm:max-w-[260px]"
              >
                <option value="">Selecciona pedido...</option>
                {orders.map((ord) => {
                  const count = ord.items?.length ?? ord.items_count ?? 1;
                  return (
                    <option key={ord.id} value={ord.id}>
                      {ord.order_number} · {ord.referral_name}{" "}
                      {count > 1 ? `(${count})` : `(${ord.size_display})`}
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant={adjustments.remove_background ? "secondary" : "outline"}
              size="sm"
              disabled={!hasSource || isBatchRunning}
              onClick={() => updateAdj("remove_background", !adjustments.remove_background)}
              leftIcon={<Eraser className="h-3.5 w-3.5 text-accent" />}
            >
              {adjustments.remove_background ? "Sin fondo ✓" : "Sin fondo"}
            </Button>

            <Button
              type="button"
              variant="dieCut"
              size="sm"
              disabled={!activeOriginalUrl || isBatchRunning}
              onClick={() => setRetouchModalOpen(true)}
              leftIcon={<Brush className="h-3.5 w-3.5 text-accent" />}
            >
              Borrador
            </Button>

            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!hasSource || isBatchRunning}
              loading={savingToOrder === "diecut"}
              onClick={() => void handleContinueToDieCut(false)}
              leftIcon={<Scissors className="h-3.5 w-3.5" />}
              rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
            >
              Troquelador
            </Button>
          </div>
        </div>

        {sourceMode === "upload" && (
          <div className="mt-2 border-t border-dashed border-line-subtle pt-2">
            <StickerDropzone
              file={uploadedFile}
              previewUrl={uploadOriginalUrl}
              onFileChange={handleUploadedFileChange}
            />
          </div>
        )}
      </div>

      {/* Main Fixed-Viewport Studio Workspace */}
      <div className="grid grid-cols-1 gap-2.5 lg:min-h-0 lg:flex-1 lg:grid-cols-12 lg:overflow-hidden">
        {/* Left/Center: Full-Height Workspace Column (Compact Order/Filmstrip + ~80% Canvas + 1-Line Status) */}
        <div className="flex h-full min-h-0 flex-col gap-2 lg:col-span-8 lg:overflow-hidden xl:col-span-9">
          {/* Compact Single-Row Order + Filmstrip Bar (~56px) separated in 3 non-overlapping zones */}
          {sourceMode === "order" && activeOrderDetail && (
            <section
              aria-label="Pedido y selector de diseños"
              className="shrink-0 rounded-sticker border border-line-subtle bg-surface-card px-2.5 py-1.5 shadow-card"
            >
              <div className="flex items-center justify-between gap-3">
                {/* Zone A (Left, shrink-0): Order Code + Client Name + Status */}
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-xs border border-line-diecut/50 bg-accent-soft/60 px-1.5 py-0.5 font-mono text-[11px] font-extrabold text-accent">
                    {activeOrderDetail.order_number}
                  </span>
                  <span className="max-w-[120px] truncate font-display text-xs font-extrabold text-ink-primary sm:max-w-[165px]">
                    {activeOrderDetail.referral_name}
                  </span>
                  <StickerBadge status={activeOrderDetail.status} size="sm" />
                </div>

                {/* Zone B (Center, flex-1 min-w-0): Clean Design Chips Selector */}
                <div
                  role="tablist"
                  aria-label="Diseños del pedido"
                  title="Selecciona un diseño (← / →)"
                  className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1"
                >
                  {orderItems.map((item, idx) => {
                    const isActive = item.id === activeItemId;
                    const itemStatus = getEffectiveItemStatus(item);
                    const statusMeta = getPrepressStatusMeta(itemStatus);
                    const isReady =
                      itemStatus === "mejorado" ||
                      itemStatus === "enhanced" ||
                      itemStatus === "Mejorado" ||
                      itemStatus === "troquelado" ||
                      itemStatus === "die_cut_ready" ||
                      itemStatus === "Troquelado" ||
                      itemStatus === "listo_pliego" ||
                      itemStatus === "print_ready" ||
                      itemStatus === "Listo";
                    const origThumb = originalUrlsByItemId[item.id] ?? null;
                    const enhThumb =
                      resultsByItemId[item.id]?.preview_data_url ??
                      serverEnhancedUrlsByItemId[item.id] ??
                      null;
                    const thumbSrc =
                      Boolean(enhThumb) && (isActive ? canvasViewMode !== "original" : true)
                        ? enhThumb
                        : origThumb;

                    return (
                      <button
                        key={item.id}
                        ref={(el) => {
                          filmstripRefs.current[idx] = el;
                        }}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => handleSelectDesignItem(item)}
                        onKeyDown={(e) => handleFilmstripKeyDown(e, idx)}
                        title={`#${item.position} · ${item.material} · ${item.size_display} · x${item.quantity} · ${statusMeta.label}`}
                        className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          isActive
                            ? "border-accent bg-accent-soft text-ink-primary shadow-xs ring-2 ring-accent/45"
                            : "border-line-subtle bg-surface-elevated/60 text-ink-secondary hover:border-line-diecut hover:bg-surface-card hover:text-ink-primary"
                        }`}
                      >
                        <div className="bg-darkroom-checker flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xs border border-darkroom-line/80 p-0.5">
                          {thumbSrc ? (
                            <img
                              src={thumbSrc}
                              alt={`#${item.position}`}
                              className="max-h-full max-w-full object-contain"
                            />
                          ) : loadingThumbnails ? (
                            <Loader2 className="h-3 w-3 animate-spin text-darkroom-muted" />
                          ) : (
                            <ImageIcon className="h-3 w-3 text-darkroom-muted" />
                          )}
                        </div>
                        <div className="leading-tight">
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-[10px] font-extrabold text-ink-primary">
                              #{item.position}
                            </span>
                            {statusMeta.spinning ? (
                              <Loader2
                                className="h-3 w-3 animate-spin text-accent"
                                aria-hidden="true"
                              />
                            ) : isReady ? (
                              <CheckCircle2
                                className="h-3 w-3 text-preflight-ok-dot"
                                aria-hidden="true"
                              />
                            ) : (
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotClasses}`}
                                aria-hidden="true"
                              />
                            )}
                          </div>
                          <span className="block max-w-[78px] truncate font-mono text-[9px] text-ink-muted">
                            {item.size_display}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Zone C (Right, shrink-0): Action Buttons (Orig./Comparar/Mej. lives in canvas bar) */}
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={!hasSource || isBatchRunning}
                    loading={savingToOrder === "keep"}
                    onClick={() => void handleSaveToOrder(undefined)}
                    leftIcon={<Save className="h-3.5 w-3.5" />}
                  >
                    Guardar
                  </Button>

                  {isMultiDesignOrder && (
                    <Button
                      type="button"
                      size="sm"
                      variant="dieCut"
                      loading={isBatchRunning}
                      disabled={!hasSource}
                      onClick={() => void handleRunBatchEnhance()}
                      title={`Aplicar ajustes actuales a los ${orderItems.length} diseños (${readyDesignsCount}/${orderItems.length} listos)`}
                      leftIcon={<Layers className="h-3.5 w-3.5 text-accent" />}
                    >
                      Aplicar a todos
                    </Button>
                  )}
                </div>
              </div>

              {/* Compact Inline Batch Progress Bar (only while running or after completion) */}
              {batchProgress && (
                <div
                  role="region"
                  aria-label="Progreso de lote"
                  aria-live="polite"
                  className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-line-diecut/60 bg-darkroom-surface px-2.5 py-1.5 text-[11px] text-darkroom-ink"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {batchProgress.running ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sborg-emerald" aria-hidden="true" />
                    ) : batchProgress.failed > 0 ? (
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-preflight-crit-dot" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-sborg-emerald" aria-hidden="true" />
                    )}
                    <span className="truncate font-bold">
                      {batchProgress.running
                        ? `Lote #${batchProgress.currentPosition ?? "—"}/${batchProgress.total}`
                        : `Lote ${batchProgress.succeeded}/${batchProgress.total}`}
                    </span>
                    <div
                      role="progressbar"
                      aria-valuenow={batchProgress.completed}
                      aria-valuemin={0}
                      aria-valuemax={batchProgress.total}
                      className="h-1.5 max-w-[160px] flex-1 overflow-hidden rounded-full bg-darkroom-mat"
                    >
                      <div
                        style={{ width: `${batchPercent}%` }}
                        className={`h-full rounded-full transition-all duration-base ${
                          batchProgress.failed > 0 && !batchProgress.running
                            ? "bg-preflight-warn-dot"
                            : "bg-sborg-emerald"
                        }`}
                      />
                    </div>
                    <span className="font-mono text-[10px] font-bold tabular-nums text-sborg-emerald">
                      {batchPercent}%
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {batchProgress.running ? (
                      <button
                        type="button"
                        onClick={handleCancelBatch}
                        className="inline-flex items-center gap-1 rounded-sm border border-darkroom-line bg-darkroom-mat px-2 py-0.5 text-[10px] font-bold text-darkroom-ink hover:border-preflight-crit-border"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                        Cancelar
                      </button>
                    ) : (
                      <>
                        {failedBatchItems.length > 0 && (
                          <button
                            type="button"
                            onClick={() => void handleRunBatchEnhance(failedBatchItems)}
                            className="inline-flex items-center gap-1 rounded-sm border border-sborg-emerald/60 bg-darkroom-elevated px-2 py-0.5 text-[10px] font-bold text-sborg-emerald hover:bg-sborg-emerald hover:text-sborg-midnight"
                          >
                            <RefreshCw className="h-3 w-3" aria-hidden="true" />
                            Reintentar ({failedBatchItems.length})
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setBatchProgress(null)}
                          aria-label="Cerrar progreso"
                          className="rounded-sm p-0.5 text-darkroom-muted hover:text-darkroom-ink"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Main Full-Height Proofing Canvas (~80% height) */}
          <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
            <BeforeAfterSlider
              originalUrl={activeOriginalUrl}
              enhancedUrl={activeEnhancedUrl}
              processing={processing}
              dpiLabel={activeResult?.target_dpi ?? adjustments.target_dpi}
              viewMode={canvasViewMode}
              onViewModeChange={setCanvasViewMode}
              supportsWhiteInk={supportsWhiteInk}
              materialLabel={activeMaterial}
              whiteInkPreview={whiteInkPreview}
              onWhiteInkPreviewChange={setWhiteInkPreview}
              serverWhiteInkMaskUrl={activeResult?.white_ink_mask_data_url ?? null}
              sizeDisplay={activeSizeDisplay || null}
              preflightSlot={preflightPillNode}
              onOriginalDimensions={handleMeasuredOriginalDims}
            />
          </div>

          {/* Compact 1-Line Technical Status Bar */}
          <div
            className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md border border-line-subtle bg-surface-card px-3 py-1 font-mono text-[11px] font-semibold tabular-nums text-ink-secondary shadow-xs"
            title={
              activeResult
                ? `Original: ${activeResult.original_width}×${activeResult.original_height} px · Salida ${adjustments.upscale_factor}x: ${activeResult.output_width}×${activeResult.output_height} px`
                : "Estado técnico de preprensa"
            }
          >
            <span className="truncate">
              {activeResult
                ? `${activeResult.output_width}×${activeResult.output_height} px`
                : activeItemId && dimsByItemId[activeItemId]
                ? `${dimsByItemId[activeItemId].width}×${dimsByItemId[activeItemId].height} px`
                : "— px"}
              {" · "}
              {activePreflight
                ? `${activePreflight.effectiveDpi} DPI`
                : `${activeResult?.target_dpi ?? adjustments.target_dpi} DPI`}
              {activeResult?.cmyk_stats
                ? ` · TAC ${activeResult.cmyk_stats.max_tac_percent.toFixed(1)}%`
                : ""}
              {activeResult ? ` · ${activeResult.processing_time_ms}ms` : ""}
            </span>
            {activeResult?.cmyk_stats?.tac_warning && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-preflight-warn-ink">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                TAC alto
              </span>
            )}
          </div>
        </div>

        {/* Right: Independent-Scroll Tool Sidebar with Fixed 4-Tab Bar */}
        <aside className="flex flex-col overflow-hidden rounded-sticker border border-line-subtle bg-surface-card shadow-card lg:col-span-4 lg:h-full lg:min-h-0 xl:col-span-3">
          {/* Fixed Sidebar 4-Tab Navigation Bar */}
          <div
            role="tablist"
            aria-label="Herramientas de mejora de calidad"
            className="grid shrink-0 grid-cols-2 gap-1 border-b border-line-subtle bg-surface-elevated/80 p-1.5 sm:grid-cols-4 lg:grid-cols-2"
          >
            {(
              [
                { id: "quality", label: "Calidad y Fondo", icon: Sparkles },
                { id: "cmyk", label: "Color CMYK", icon: Droplets },
                { id: "retouch", label: "Retoque", icon: Brush },
                { id: "save", label: "Guardar", icon: Save },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-extrabold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isActive
                      ? "bg-accent text-accent-ink shadow-xs"
                      : "text-ink-secondary hover:bg-surface-card hover:text-ink-primary"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Independent Scrollable Tool Body */}
          <div className="flex-1 space-y-3.5 overflow-y-auto p-3">
            {/* Compact Auto-Preview Toggle */}
            <div className="flex items-center justify-between gap-2 rounded-md border border-line-subtle bg-surface-elevated/55 px-2.5 py-1.5">
              <span className="font-mono text-[10px] font-extrabold uppercase tracking-wider text-ink-secondary">
                Calibración OpenCV
              </span>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-ink-secondary hover:text-ink-primary">
                <input
                  type="checkbox"
                  checked={autoPreview}
                  onChange={(e) => setAutoPreview(e.target.checked)}
                  className="h-3.5 w-3.5 rounded-xs border-line-strong accent-accent focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span>Auto-preview</span>
              </label>
            </div>

            {/* TAB 1: CALIDAD Y FONDO (DPI, Upscale, Quitar Fondo, Nitidez, Presets) */}
            {activeTab === "quality" && (
              <div className="space-y-3">
                {/* Quick Print Presets */}
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-1.5">
                    {PRINT_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        disabled={isBatchRunning}
                        onClick={() => handleApplyPreset(preset)}
                        className="rounded-md border border-line-subtle bg-surface-card px-2 py-1.5 text-left transition-colors duration-fast hover:border-line-diecut hover:bg-accent-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      >
                        <span className="block truncate text-[11px] font-bold text-ink-primary">
                          {preset.label}
                        </span>
                        <span className="block truncate font-mono text-[9px] text-ink-muted">
                          {preset.subtitle}
                        </span>
                      </button>
                    ))}
                  </div>

                  {recommendedPreset && sourceMode === "order" && activeMaterial && (
                    <button
                      type="button"
                      disabled={isBatchRunning}
                      onClick={() => handleApplyPreset(recommendedPreset)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line-diecut bg-accent-soft/55 px-2.5 py-1.5 text-[11px] font-bold text-ink-primary transition-colors hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      <Wand2 className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                      <span className="truncate">Perfil sugerido: {activeMaterial}</span>
                    </button>
                  )}
                </div>

                {/* Upscale Factor */}
                <div className="space-y-1">
                  <span className="block font-mono text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                    Escalado (Lanczos-4)
                  </span>
                  <div className="grid grid-cols-5 gap-1">
                    {[1, 1.5, 2, 3, 4].map((scale) => (
                      <button
                        key={scale}
                        type="button"
                        aria-pressed={adjustments.upscale_factor === scale}
                        onClick={() => updateAdj("upscale_factor", scale)}
                        className={`rounded-md border py-1.5 font-mono text-[11px] font-bold tabular-nums transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          adjustments.upscale_factor === scale
                            ? "border-accent bg-accent text-accent-ink shadow-xs"
                            : "border-line-subtle bg-surface-card text-ink-primary hover:border-line-strong hover:bg-surface-elevated"
                        }`}
                      >
                        {scale}x
                      </button>
                    ))}
                  </div>
                </div>

                {/* Target DPI */}
                <div className="space-y-1">
                  <span className="block font-mono text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                    Metadato DPI de Salida
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[150, 300, 600].map((dpi) => (
                      <button
                        key={dpi}
                        type="button"
                        aria-pressed={adjustments.target_dpi === dpi}
                        onClick={() => updateAdj("target_dpi", dpi)}
                        className={`rounded-md border py-1.5 font-mono text-[11px] font-bold tabular-nums transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          adjustments.target_dpi === dpi
                            ? "border-accent bg-accent text-accent-ink shadow-xs"
                            : "border-line-subtle bg-surface-card text-ink-primary hover:border-line-strong hover:bg-surface-elevated"
                        }`}
                      >
                        {dpi}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Background Removal Compact Accordion */}
                <div className="space-y-2.5 rounded-lg border border-dashed border-line-diecut/80 bg-accent-soft/35 p-2.5">
                  <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-bold text-ink-primary">
                      <Eraser className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                      <span>Quitar Fondo (PNG)</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={adjustments.remove_background}
                      onChange={(e) => updateAdj("remove_background", e.target.checked)}
                      className="h-4 w-4 shrink-0 rounded-xs border-line-strong accent-accent focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>

                  {adjustments.remove_background && (
                    <div className="space-y-2.5 border-t border-dashed border-line-subtle pt-2">
                      <div className="grid grid-cols-3 gap-1 text-[10px] font-bold">
                        {(
                          [
                            ["smart_subject", "Principal"],
                            ["auto_color", "Sólido"],
                            ["grabcut", "Foto"],
                          ] as const
                        ).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            aria-pressed={adjustments.bg_mode === mode}
                            onClick={() => updateAdj("bg_mode", mode)}
                            className={`rounded-sm border px-1.5 py-1 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              adjustments.bg_mode === mode
                                ? "border-accent bg-accent text-accent-ink"
                                : "border-line-subtle bg-surface-card text-ink-secondary hover:text-ink-primary"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      {adjustments.bg_mode !== "grabcut" && (
                        <SliderControl
                          label="Tolerancia fondo"
                          value={adjustments.bg_tolerance}
                          min={5}
                          max={90}
                          onChange={(v) => updateAdj("bg_tolerance", v)}
                        />
                      )}
                      <SliderControl
                        label="Suavizado borde"
                        value={adjustments.bg_feather}
                        min={0}
                        max={5}
                        unit=" px"
                        onChange={(v) => updateAdj("bg_feather", v)}
                      />
                    </div>
                  )}
                </div>

                <SliderControl
                  label="Reducción de Ruido"
                  value={adjustments.denoise_strength}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(v) => updateAdj("denoise_strength", v)}
                />

                <SliderControl
                  label="Nitidez (Unsharp Mask)"
                  value={adjustments.sharpen_strength}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(v) => updateAdj("sharpen_strength", v)}
                />

                <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-line-subtle bg-surface-elevated/60 px-2.5 py-2 text-[11px] font-semibold text-ink-primary hover:border-line-strong">
                  <span>Auto-Contraste LAB (CLAHE)</span>
                  <input
                    type="checkbox"
                    checked={adjustments.auto_contrast}
                    onChange={(e) => updateAdj("auto_contrast", e.target.checked)}
                    className="h-3.5 w-3.5 shrink-0 rounded-xs border-line-strong accent-accent focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
              </div>
            )}

            {/* TAB 2: COLOR CMYK (Ajustes tonales, Canales CMYK, TAC, Tinta Blanca) */}
            {activeTab === "cmyk" && (
              <div className="space-y-3">
                {/* White Ink Quick Control when Transparente / DTF UV */}
                {supportsWhiteInk && (
                  <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-line-strong/60 bg-darkroom-surface px-2.5 py-2 text-xs text-darkroom-ink">
                    <span className="inline-flex items-center gap-1.5 font-bold">
                      <Layers className="h-3.5 w-3.5 text-sborg-emerald" aria-hidden="true" />
                      <span>Cama Blanca ({activeMaterial})</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={whiteInkPreview}
                      onChange={(e) => setWhiteInkPreview(e.target.checked)}
                      className="h-4 w-4 shrink-0 rounded-xs accent-accent focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                )}

                <div className="space-y-2.5 rounded-lg border border-line-subtle bg-surface-elevated/45 p-2.5">
                  <span className="flex items-center gap-1.5 font-mono text-[10px] font-extrabold uppercase tracking-wider text-ink-secondary">
                    <SunMedium className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    <span>Ajustes Tonales</span>
                  </span>
                  <SliderControl
                    label="Brillo"
                    value={adjustments.brightness}
                    min={-100}
                    max={100}
                    onChange={(v) => updateAdj("brightness", v)}
                  />
                  <SliderControl
                    label="Contraste"
                    value={adjustments.contrast}
                    min={-100}
                    max={100}
                    onChange={(v) => updateAdj("contrast", v)}
                  />
                  <SliderControl
                    label="Saturación"
                    value={adjustments.saturation}
                    min={-100}
                    max={100}
                    unit="%"
                    onChange={(v) => updateAdj("saturation", v)}
                  />
                  <SliderControl
                    label="Gamma (Medios Tonos)"
                    value={adjustments.gamma}
                    min={0.5}
                    max={2.0}
                    step={0.05}
                    onChange={(v) => updateAdj("gamma", v)}
                  />
                </div>

                <div className="space-y-2.5 rounded-lg border border-line-subtle bg-surface-elevated/45 p-2.5">
                  <span className="flex items-center gap-1.5 font-mono text-[10px] font-extrabold uppercase tracking-wider text-ink-secondary">
                    <Droplets className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    <span>Canales CMYK y Límite TAC</span>
                  </span>
                  <SliderControl
                    label="Cian (C)"
                    value={adjustments.cyan}
                    min={-50}
                    max={50}
                    unit="%"
                    onChange={(v) => updateAdj("cyan", v)}
                  />
                  <SliderControl
                    label="Magenta (M)"
                    value={adjustments.magenta}
                    min={-50}
                    max={50}
                    unit="%"
                    onChange={(v) => updateAdj("magenta", v)}
                  />
                  <SliderControl
                    label="Amarillo (Y)"
                    value={adjustments.yellow}
                    min={-50}
                    max={50}
                    unit="%"
                    onChange={(v) => updateAdj("yellow", v)}
                  />
                  <SliderControl
                    label="Negro / Key (K)"
                    value={adjustments.black}
                    min={-50}
                    max={50}
                    unit="%"
                    onChange={(v) => updateAdj("black", v)}
                  />

                  <div
                    className="border-t border-dashed border-line-subtle pt-2.5"
                    title="Limita C+M+Y+K para evitar saturación en sustrato."
                  >
                    <Select
                      label="Límite de Tinta (TAC)"
                      value={String(adjustments.ink_limit_percent)}
                      onChange={(e) => updateAdj("ink_limit_percent", Number(e.target.value))}
                    >
                      <option value="240">240% · Papel adhesivo</option>
                      <option value="260">260% · Ahorro de tinta</option>
                      <option value="280">280% · Vinilo estándar</option>
                      <option value="300">300% · Vinilo / DTF UV</option>
                      <option value="400">400% · Sin límite</option>
                    </Select>
                  </div>
                </div>

                {/* CMYK Ink Telemetry relocated inside Color CMYK tab */}
                <CmykTelemetryBar
                  stats={activeResult?.cmyk_stats ?? null}
                  inkLimit={adjustments.ink_limit_percent}
                />
              </div>
            )}

            {/* TAB 3: RETOQUE (Borrador Mágico y Marcas de Agua) */}
            {activeTab === "retouch" && (
              <div className="space-y-3">
                <div
                  className="space-y-2.5 rounded-lg border border-dashed border-line-diecut/75 bg-accent-soft/35 p-3"
                  title="Pinta sobre marcas de agua, textos o imperfecciones para restaurar el fondo con inpainting OpenCV."
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink shadow-xs">
                      <Brush className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="text-xs">
                      <p className="font-bold text-ink-primary">Borrador Mágico</p>
                      <p className="text-[10px] text-ink-secondary">
                        Inpainting y marcas de agua
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      fullWidth
                      disabled={!activeOriginalUrl || isBatchRunning}
                      onClick={() => setRetouchModalOpen(true)}
                      leftIcon={<Brush className="h-3.5 w-3.5" />}
                    >
                      {activeRetouched
                        ? "Seguir editando retoque"
                        : "Abrir Borrador / Marcas de Agua"}
                    </Button>

                    {activeRetouched && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        fullWidth
                        onClick={clearActiveRetouched}
                        leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                      >
                        Descartar retoque y volver al original
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: GUARDAR (Guardar en Pedido, Lotes, Troquelador y Exportación) */}
            {activeTab === "save" && (
              <div className="space-y-3">
                {/* Save Calibrated Design to Order */}
                {sourceMode === "order" && activeOrderDetail && (
                  <div className="space-y-2.5 rounded-lg border border-dashed border-line-strong bg-surface-elevated/60 p-3">
                    <div className="flex items-center gap-2 text-xs">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                      <span className="font-semibold text-ink-primary">
                        Guardar{" "}
                        {isMultiDesignOrder && activeDesignItem
                          ? `Diseño #${activeDesignItem.position}`
                          : "arte"}{" "}
                        en{" "}
                        <span className="font-mono text-accent">
                          {activeOrderDetail.order_number}
                        </span>
                      </span>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        fullWidth
                        disabled={!hasSource || isBatchRunning}
                        loading={savingToOrder === "keep"}
                        onClick={() => void handleSaveToOrder(undefined)}
                        leftIcon={<Save className="h-3.5 w-3.5" />}
                      >
                        Guardar arte mejorado
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="inverted"
                        fullWidth
                        disabled={!hasSource || isBatchRunning}
                        loading={savingToOrder === "En Impresión"}
                        onClick={() => void handleSaveToOrder("En Impresión")}
                        leftIcon={<Printer className="h-3.5 w-3.5" />}
                      >
                        Guardar → En Impresión
                      </Button>
                    </div>
                  </div>
                )}

                {/* Batch Processing for Multi-Design Orders */}
                {isMultiDesignOrder && (
                  <div className="space-y-2 rounded-lg border border-dashed border-line-diecut bg-accent-soft/35 p-3">
                    <p className="text-[11px] font-bold text-ink-primary">
                      Procesamiento por lotes ({orderItems.length} diseños)
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="dieCut"
                      fullWidth
                      disabled={!hasSource}
                      loading={isBatchRunning}
                      onClick={() => void handleRunBatchEnhance()}
                      leftIcon={<Layers className="h-3.5 w-3.5 text-accent" />}
                    >
                      Aplicar a todos ({orderItems.length} diseños)
                    </Button>
                  </div>
                )}

                {/* Continue to Vector Die-Cut Studio */}
                <div className="space-y-2 rounded-lg border border-dashed border-line-diecut bg-accent-soft/45 p-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-bold text-ink-primary">
                      <Scissors className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                      <span>Troquelador Vectorial</span>
                    </span>
                    {(adjustments.remove_background || activeResult?.has_transparency) && (
                      <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-accent-ink">
                        PNG Transparente
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    {!adjustments.remove_background && !activeResult?.has_transparency && (
                      <Button
                        type="button"
                        size="sm"
                        variant="dieCut"
                        fullWidth
                        disabled={!hasSource || isBatchRunning}
                        loading={savingToOrder === "diecut"}
                        onClick={() => void handleContinueToDieCut(true)}
                        leftIcon={<Eraser className="h-3.5 w-3.5 text-accent" />}
                      >
                        Quitar fondo e Ir
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      fullWidth
                      disabled={!hasSource || isBatchRunning}
                      loading={savingToOrder === "diecut"}
                      onClick={() => void handleContinueToDieCut(false)}
                      rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
                    >
                      Ir al Troquelador
                    </Button>
                  </div>
                </div>

                {/* Print Export Strip */}
                <div className="space-y-2 rounded-lg border border-line-subtle bg-surface-elevated/55 p-3">
                  <span className="block font-mono text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                    Exportar{" "}
                    {isMultiDesignOrder && activeDesignItem
                      ? `Diseño #${activeDesignItem.position}`
                      : "arte actual"}
                  </span>
                  <div className="flex flex-col gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      fullWidth
                      disabled={!hasSource || isBatchRunning}
                      loading={exportingFormat === "png_rgb"}
                      onClick={() => void handleExport("png_rgb")}
                      leftIcon={<FileImage className="h-3.5 w-3.5" />}
                    >
                      PNG {adjustments.target_dpi} DPI
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      fullWidth
                      disabled={!hasSource || isBatchRunning}
                      loading={exportingFormat === "tiff_cmyk"}
                      onClick={() => void handleExport("tiff_cmyk")}
                      leftIcon={<Download className="h-3.5 w-3.5" />}
                    >
                      TIFF CMYK
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      fullWidth
                      disabled={!hasSource || isBatchRunning}
                      loading={exportingFormat === "jpeg_cmyk"}
                      onClick={() => void handleExport("jpeg_cmyk")}
                      leftIcon={<Download className="h-3.5 w-3.5" />}
                    >
                      JPG CMYK
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Fixed Bottom Sidebar Actions */}
          <div className="flex shrink-0 gap-2 border-t border-line-subtle bg-surface-elevated/80 p-2.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isBatchRunning}
              onClick={handleReset}
              leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
            >
              Reset
            </Button>
            <Button
              type="button"
              size="sm"
              fullWidth
              disabled={!hasSource || isBatchRunning}
              loading={processing}
              onClick={() => void runEnhancement(adjustments, false)}
              leftIcon={<SlidersHorizontal className="h-3.5 w-3.5" />}
            >
              Aplicar OpenCV
            </Button>
          </div>
        </aside>
      </div>

      {/* Illustrator-Style Content-Aware Eraser & Watermark Removal Modal */}
      <RetouchInpaintModal
        isOpen={retouchModalOpen}
        onClose={() => setRetouchModalOpen(false)}
        sourceImageUrl={activeRetouched?.previewUrl || activeOriginalUrl}
        sourceLabel={
          sourceMode === "order"
            ? `${activeOrderDetail?.order_number || "Pedido"}${
                isMultiDesignOrder && activeDesignItem ? ` · Diseño #${activeDesignItem.position}` : ""
              }`
            : uploadedFile?.name || "Imagen subida"
        }
        onApplyRetouched={handleApplyRetouchedFile}
      />
    </motion.div>
  );
};
