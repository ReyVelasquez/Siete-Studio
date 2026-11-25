import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  FileText,
  FolderOpen,
  Hexagon,
  Image as ImageIcon,
  Layers,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Palette,
  RectangleHorizontal,
  RefreshCw,
  Ruler,
  Save,
  Scissors,
  Scroll,
  Sparkles,
  Square,
  Trash2,
  Unlock,
  Upload,
} from "lucide-react";
import { pageTransitionVariants } from "@/config/animations";
import {
  DieCutVectorCanvas,
  measureBezierContourBBoxPx,
} from "@/components/image-processing/DieCutVectorCanvas";
import { StickerDropzone } from "@/components/orders/StickerDropzone";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { StickerBadge } from "@/components/ui/StickerBadge";
import { StickerCard } from "@/components/ui/StickerCard";
import { useToast } from "@/hooks/useToast";
import { imageProcessingService } from "@/services/imageProcessing.service";
import { ordersService } from "@/services/orders.service";
import {
  previewSimplifiedNodeCount,
  simplifyBezierContour,
  toggleAnchorSmoothCorner,
} from "@/utils/bezierSimplify";
import type {
  BezierAnchor,
  DetectEdgesParams,
  DetectEdgesResult,
  DieCutBorderCutPosition,
  DieCutBorderMode,
  DieCutCutContourTone,
  DieCutDirection,
  DieCutFitMode,
  OrderDesignItemResponse,
  OrderItem,
} from "@/types/order";

type DieCutUiShapePreset =
  | "en_su_forma"
  | "circular"
  | "rectangular"
  | "cuadrado"
  | "poligono_regular";

const DEFAULT_PARAMS: DetectEdgesParams = {
  mode: "en_su_forma",
  cut_direction: "outside",
  dpi: 300,
  bleed_mm: 2.5,
  white_border_mm: 0.0,
  corner_roundness: 0.65,
  smoothing_epsilon: 0.004,
  polygon_sides: 6,
  polygon_rotation_deg: 0,
  remove_background: false,
  bg_tolerance: 28,
  merge_islands: true,
  border_mode: "none",
  border_color: null,
  border_width_mm: 2.0,
  border_cut_position: "inside_base",
  border_offset_mm: 1.5,
  target_width_cm: null,
  target_height_cm: null,
  fit_mode: "contain_proportional",
};

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

function mapOrderShapeToConfig(shape?: string): {
  preset: DieCutUiShapePreset;
  paramsPatch: Partial<DetectEdgesParams>;
} {
  switch (shape) {
    case "Circular":
      return {
        preset: "circular",
        paramsPatch: { mode: "circular" },
      };
    case "Rectangular":
      return {
        preset: "rectangular",
        paramsPatch: { mode: "en_su_forma" },
      };
    case "Cuadrado":
      return {
        preset: "cuadrado",
        paramsPatch: { mode: "poligono_regular", polygon_sides: 4, polygon_rotation_deg: 0 },
      };
    case "En su forma":
    default:
      return {
        preset: "en_su_forma",
        paramsPatch: { mode: "en_su_forma" },
      };
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Build a precision 8-anchor rounded-rectangle cubic Bezier contour around the detected
 * artwork bounding box so `Rectangular` order items get true axis-aligned rounded corners
 * while remaining 100% manually editable and .EPS/.SVG exportable.
 */
function buildRoundedRectAnchors(
  sourceAnchors: BezierAnchor[],
  imageWidth: number,
  imageHeight: number,
  roundness: number
): BezierAnchor[] {
  let minX = imageWidth * 0.08;
  let maxX = imageWidth * 0.92;
  let minY = imageHeight * 0.08;
  let maxY = imageHeight * 0.92;

  if (sourceAnchors.length >= 3) {
    let bx0 = Number.POSITIVE_INFINITY;
    let bx1 = Number.NEGATIVE_INFINITY;
    let by0 = Number.POSITIVE_INFINITY;
    let by1 = Number.NEGATIVE_INFINITY;
    for (const a of sourceAnchors) {
      if (a.x < bx0) bx0 = a.x;
      if (a.x > bx1) bx1 = a.x;
      if (a.y < by0) by0 = a.y;
      if (a.y > by1) by1 = a.y;
    }
    if (bx1 - bx0 > 12 && by1 - by0 > 12) {
      minX = Math.max(2, bx0);
      maxX = Math.min(imageWidth - 2, bx1);
      minY = Math.max(2, by0);
      maxY = Math.min(imageHeight - 2, by1);
    }
  }

  const w = Math.max(16, maxX - minX);
  const h = Math.max(16, maxY - minY);
  const maxR = Math.min(w, h) * 0.42;
  const r = Math.max(2, Math.min(maxR, Math.min(w, h) * 0.32 * Math.max(0.08, Math.min(1, roundness))));
  const k = r * 0.55228475;

  return [
    {
      x: round2(maxX - r),
      y: round2(minY),
      in_x: round2(maxX - r),
      in_y: round2(minY),
      out_x: round2(maxX - r + k),
      out_y: round2(minY),
      smooth: true,
    },
    {
      x: round2(maxX),
      y: round2(minY + r),
      in_x: round2(maxX),
      in_y: round2(minY + r - k),
      out_x: round2(maxX),
      out_y: round2(minY + r),
      smooth: true,
    },
    {
      x: round2(maxX),
      y: round2(maxY - r),
      in_x: round2(maxX),
      in_y: round2(maxY - r),
      out_x: round2(maxX),
      out_y: round2(maxY - r + k),
      smooth: true,
    },
    {
      x: round2(maxX - r),
      y: round2(maxY),
      in_x: round2(maxX - r + k),
      in_y: round2(maxY),
      out_x: round2(maxX - r),
      out_y: round2(maxY),
      smooth: true,
    },
    {
      x: round2(minX + r),
      y: round2(maxY),
      in_x: round2(minX + r),
      in_y: round2(maxY),
      out_x: round2(minX + r - k),
      out_y: round2(maxY),
      smooth: true,
    },
    {
      x: round2(minX),
      y: round2(maxY - r),
      in_x: round2(minX),
      in_y: round2(maxY - r + k),
      out_x: round2(minX),
      out_y: round2(maxY - r),
      smooth: true,
    },
    {
      x: round2(minX),
      y: round2(minY + r),
      in_x: round2(minX),
      in_y: round2(minY + r),
      out_x: round2(minX),
      out_y: round2(minY + r - k),
      smooth: true,
    },
    {
      x: round2(minX + r),
      y: round2(minY),
      in_x: round2(minX + r - k),
      in_y: round2(minY),
      out_x: round2(minX + r),
      out_y: round2(minY),
      smooth: true,
    },
  ];
}

/** Recompute smooth Catmull-Rom rounded cubic Bezier handles across all current anchors. */
function recomputeRoundedHandles(anchors: BezierAnchor[], roundness: number): BezierAnchor[] {
  const n = anchors.length;
  if (n < 3) return anchors;
  const tension = Math.max(0.08, Math.min(0.85, roundness)) * 0.45;

  return anchors.map((curr, i) => {
    const prev = anchors[(i - 1 + n) % n];
    const next = anchors[(i + 1) % n];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const tLen = Math.hypot(tx, ty);
    const dPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const dNext = Math.hypot(next.x - curr.x, next.y - curr.y);

    if (tLen < 1e-5) {
      return { ...curr, in_x: curr.x, in_y: curr.y, out_x: curr.x, out_y: curr.y, smooth: true };
    }

    const ux = tx / tLen;
    const uy = ty / tLen;
    const inLen = Math.min(dPrev * tension, dPrev * 0.45);
    const outLen = Math.min(dNext * tension, dNext * 0.45);

    return {
      ...curr,
      in_x: round2(curr.x - ux * inLen),
      in_y: round2(curr.y - uy * inLen),
      out_x: round2(curr.x + ux * outLen),
      out_y: round2(curr.y + uy * outLen),
      smooth: true,
    };
  });
}

function parseItemDimensionsCm(
  item: OrderDesignItemResponse | null
): { widthCm: number | null; heightCm: number | null } | null {
  if (!item) return null;
  if (item.shape === "Circular" && item.diameter_cm != null) {
    const d = Number(item.diameter_cm);
    if (Number.isFinite(d) && d > 0) return { widthCm: d, heightCm: d };
  }
  if (item.size_mode === "height_only" && item.height_cm && item.height_cm > 0) {
    return { widthCm: null, heightCm: Number(item.height_cm) };
  }
  if (item.size_mode === "width_only" && item.width_cm && item.width_cm > 0) {
    return { widthCm: Number(item.width_cm), heightCm: null };
  }
  const raw = (item.dimensions || item.size_display || "").trim();
  const rectMatch = /(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)/.exec(raw);
  if (rectMatch) {
    const heightCm = Number(rectMatch[1].replace(",", "."));
    const widthCm = Number(rectMatch[2].replace(",", "."));
    if (Number.isFinite(heightCm) && Number.isFinite(widthCm) && heightCm > 0 && widthCm > 0) {
      return { widthCm, heightCm };
    }
  }
  const heightOnlyMatch = /^\s*alto\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i.exec(raw);
  if (heightOnlyMatch) {
    const h = Number(heightOnlyMatch[1].replace(",", "."));
    if (Number.isFinite(h) && h > 0) return { widthCm: null, heightCm: h };
  }
  const widthOnlyMatch = /^\s*ancho\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i.exec(raw);
  if (widthOnlyMatch) {
    const w = Number(widthOnlyMatch[1].replace(",", "."));
    if (Number.isFinite(w) && w > 0) return { widthCm: w, heightCm: null };
  }
  const circMatch = /(\d+(?:[.,]\d+)?)/.exec(raw);
  if (circMatch && item.shape === "Circular") {
    const d = Number(circMatch[1].replace(",", "."));
    if (Number.isFinite(d) && d > 0) return { widthCm: d, heightCm: d };
  }
  return null;
}

function formatCmLabel(v?: number | null): string {
  if (!v || !Number.isFinite(v) || v <= 0) return "—";
  return Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1);
}

/** Build a full-frame rounded rectangle contour when the operator toggles to include the full opaque background. */
function buildFullFrameBoundaryAnchors(
  imageWidth: number,
  imageHeight: number,
  roundness: number
): BezierAnchor[] {
  const marginX = Math.max(8, Math.round(imageWidth * 0.06));
  const marginY = Math.max(8, Math.round(imageHeight * 0.06));
  const frameSeeds: BezierAnchor[] = [
    {
      x: marginX,
      y: marginY,
      in_x: marginX,
      in_y: marginY,
      out_x: marginX,
      out_y: marginY,
      smooth: true,
    },
    {
      x: imageWidth - marginX,
      y: marginY,
      in_x: imageWidth - marginX,
      in_y: marginY,
      out_x: imageWidth - marginX,
      out_y: marginY,
      smooth: true,
    },
    {
      x: imageWidth - marginX,
      y: imageHeight - marginY,
      in_x: imageWidth - marginX,
      in_y: imageHeight - marginY,
      out_x: imageWidth - marginX,
      out_y: imageHeight - marginY,
      smooth: true,
    },
    {
      x: marginX,
      y: imageHeight - marginY,
      in_x: marginX,
      in_y: imageHeight - marginY,
      out_x: marginX,
      out_y: imageHeight - marginY,
      smooth: true,
    },
  ];
  return buildRoundedRectAnchors(frameSeeds, imageWidth, imageHeight, roundness);
}

const POLYGON_PRESETS = [
  { sides: 3, label: "Triángulo (3)" },
  { sides: 4, label: "Cuadrado (4)" },
  { sides: 5, label: "Pentágono (5)" },
  { sides: 6, label: "Hexágono (6)" },
  { sides: 8, label: "Octágono (8)" },
  { sides: 10, label: "Decágono (10)" },
];

const WHITE_BORDER_QUICK_PRESETS = [0, 2, 3.5, 5];

interface DesignDieCutSession {
  shapePreset: DieCutUiShapePreset;
  params: DetectEdgesParams;
  result: DetectEdgesResult | null;
  anchors: BezierAnchor[];
  history: BezierAnchor[][];
  future: BezierAnchor[][];
  borderMode: DieCutBorderMode;
  customBorderColor: string;
  borderWidthMm: number;
  borderCutPosition: DieCutBorderCutPosition;
  borderOffsetMm: number;
  cutStrokeWidthPt: number;
  detectionSignature: string;
  includeOriginalBackground?: boolean;
  /** When false (default), automatically uses `enhanced_storage_path` (300 DPI) if available */
  useOriginalArtwork?: boolean;
}

function itemHasEnhancedArtwork(item?: OrderDesignItemResponse | null): boolean {
  if (!item) return false;
  return Boolean(
    item.enhanced_storage_path ||
      item.has_enhanced_image ||
      item.prepress_status === "mejorado" ||
      item.prepress_status === "troquelado" ||
      item.prepress_status === "listo_pliego"
  );
}

function parseSavedBezierAnchors(rawJson?: string | null): BezierAnchor[] | null {
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed) || parsed.length < 3) return null;
    const valid = parsed.every(
      (pt) =>
        pt &&
        typeof pt.x === "number" &&
        typeof pt.y === "number" &&
        typeof pt.in_x === "number" &&
        typeof pt.in_y === "number" &&
        typeof pt.out_x === "number" &&
        typeof pt.out_y === "number"
    );
    return valid ? (parsed as BezierAnchor[]) : null;
  } catch {
    return null;
  }
}

function createInitialSession(
  shape?: string,
  defaultDpi = 300,
  targetDims?: { widthCm: number | null; heightCm: number | null } | null
): DesignDieCutSession {
  const { preset, paramsPatch } = mapOrderShapeToConfig(shape);
  return {
    shapePreset: preset,
    params: {
      ...DEFAULT_PARAMS,
      dpi: defaultDpi,
      target_width_cm: targetDims?.widthCm ?? null,
      target_height_cm: targetDims?.heightCm ?? null,
      fit_mode: "contain_proportional",
      ...paramsPatch,
    },
    result: null,
    anchors: [],
    history: [],
    future: [],
    borderMode: "none",
    customBorderColor: "#FFFFFF",
    borderWidthMm: 2.0,
    borderCutPosition: "inside_base",
    borderOffsetMm: 1.5,
    cutStrokeWidthPt: 0.5,
    detectionSignature: "",
    includeOriginalBackground: false,
    useOriginalArtwork: false,
  };
}

export const DieCutStudioPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const { pushToast } = useToast();

  const navState = location.state as {
    order?: OrderItem;
    itemId?: string;
    file?: File;
    dpi?: number;
  } | null;
  const urlOrderId = searchParams.get("orderId") || "";
  const urlItemId = searchParams.get("itemId") || navState?.itemId || "";

  const [sourceMode, setSourceMode] = useState<"order" | "upload">(
    navState?.file && !urlOrderId ? "upload" : "order"
  );
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>(urlOrderId);
  const [selectedItemId, setSelectedItemId] = useState<string>(urlItemId);
  const [activeOrder, setActiveOrder] = useState<OrderItem | null>(
    navState?.order && navState.order.id === urlOrderId ? navState.order : null
  );

  // Standalone upload state
  const [uploadedFile, setUploadedFile] = useState<File | null>(navState?.file ?? null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(() =>
    navState?.file ? URL.createObjectURL(navState.file) : null
  );
  const [uploadSession, setUploadSession] = useState<DesignDieCutSession>(() =>
    createInitialSession(undefined, navState?.dpi || 300, { widthCm: 5, heightCm: 5 })
  );

  // Per-design-item isolated die-cut sessions (preserves manual Bezier edits when switching items!)
  const [sessionsByItemId, setSessionsByItemId] = useState<Record<string, DesignDieCutSession>>({});
  const [thumbsByItemId, setThumbsByItemId] = useState<Record<string, string>>({});
  const [originalThumbsByItemId, setOriginalThumbsByItemId] = useState<Record<string, string>>({});
  const [loadingThumbs, setLoadingThumbs] = useState(false);
  const [savedEpsByItemId, setSavedEpsByItemId] = useState<Record<string, boolean>>({});
  const [savedAnchorsByItemId, setSavedAnchorsByItemId] = useState<Record<string, boolean>>({});

  // Shared illustrator-like layer & canvas UI controls
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [showDesignLayer, setShowDesignLayer] = useState(true);
  const [designOpacity, setDesignOpacity] = useState(100);
  const [showCutLayer, setShowCutLayer] = useState(true);
  const [cutLayerLocked, setCutLayerLocked] = useState(false);
  const [dashedPreview, setDashedPreview] = useState(false);
  const [showPoints, setShowPoints] = useState(true);
  const [simplifyIntensity, setSimplifyIntensity] = useState<number>(35);
  const [cutContourTone, setCutContourTone] = useState<DieCutCutContourTone>("magenta");
  const [activeToolTab, setActiveToolTab] = useState<"forma" | "trazado" | "exportar">("forma");

  const [detecting, setDetecting] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const detectSeqRef = useRef(0);
  const filmstripRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const prevOrderIdRef = useRef<string>("");

  const orderItems = useMemo(() => normalizeOrderItems(activeOrder), [activeOrder]);
  const isMultiDesignOrder = sourceMode === "order" && orderItems.length >= 2;

  const activeDesignItem = useMemo<OrderDesignItemResponse | null>(() => {
    if (sourceMode !== "order" || orderItems.length === 0) return null;
    return orderItems.find((it) => it.id === selectedItemId) ?? orderItems[0];
  }, [sourceMode, orderItems, selectedItemId]);

  const activeItemId = activeDesignItem?.id ?? "";
  const activeMaterial = activeDesignItem?.material ?? activeOrder?.material ?? "";
  const activeShape = activeDesignItem?.shape ?? activeOrder?.shape ?? "En su forma";
  const activeSizeDisplay = activeDesignItem?.size_display ?? activeOrder?.size_display ?? "";
  const activeQuantity = activeDesignItem?.quantity ?? activeOrder?.quantity ?? 0;

  const fallbackItemCm = useMemo(
    () => parseItemDimensionsCm(activeDesignItem),
    [activeDesignItem]
  );

  // Resolve active working session (either upload session or active item's isolated session)
  const activeSession = useMemo<DesignDieCutSession>(() => {
    if (sourceMode === "upload") return uploadSession;
    if (activeItemId && sessionsByItemId[activeItemId]) {
      return sessionsByItemId[activeItemId];
    }
    return createInitialSession(activeDesignItem?.shape, navState?.dpi || 300, fallbackItemCm);
  }, [
    sourceMode,
    uploadSession,
    activeItemId,
    sessionsByItemId,
    activeDesignItem?.shape,
    navState?.dpi,
    fallbackItemCm,
  ]);

  const updateActiveSession = useCallback(
    (updater: (prev: DesignDieCutSession) => DesignDieCutSession) => {
      if (sourceMode === "upload") {
        setUploadSession((prev) => updater(prev));
        return;
      }
      if (!activeItemId) return;
      setSessionsByItemId((prev) => {
        const base =
          prev[activeItemId] ??
          createInitialSession(activeDesignItem?.shape, navState?.dpi || 300, fallbackItemCm);
        return { ...prev, [activeItemId]: updater(base) };
      });
    },
    [sourceMode, activeItemId, activeDesignItem?.shape, navState?.dpi, fallbackItemCm]
  );

  const {
    shapePreset,
    params,
    result,
    anchors,
    history,
    future,
    borderMode,
    customBorderColor,
    borderWidthMm,
    borderCutPosition,
    borderOffsetMm,
    cutStrokeWidthPt,
  } = activeSession;

  const activeBorderColor: string | null =
    borderMode === "none"
      ? null
      : borderMode === "white"
      ? "#FFFFFF"
      : borderMode === "base_color"
      ? result?.detected_base_color ?? null
      : customBorderColor || result?.detected_base_color || "#FFFFFF";

  // Sync URL params (?orderId=...&itemId=...) only when URL actually changes
  const prevUrlParamsRef = useRef({ orderId: urlOrderId, itemId: urlItemId });
  useEffect(() => {
    const prev = prevUrlParamsRef.current;
    if (urlOrderId === prev.orderId && urlItemId === prev.itemId) return;
    prevUrlParamsRef.current = { orderId: urlOrderId, itemId: urlItemId };

    if (urlOrderId && urlOrderId !== selectedOrderId) {
      setSourceMode("order");
      setSelectedOrderId(urlOrderId);
      setSelectedItemId(urlItemId);
    } else if (urlItemId && urlItemId !== selectedItemId && sourceMode === "order") {
      setSelectedItemId(urlItemId);
    }
  }, [urlOrderId, urlItemId, selectedOrderId, selectedItemId, sourceMode]);

  // Keep selectedItemId valid when activeOrder updates
  useEffect(() => {
    if (sourceMode !== "order" || orderItems.length === 0) return;
    const exists = orderItems.some((it) => it.id === selectedItemId);
    if (!exists) {
      setSelectedItemId(orderItems[0].id);
    }
  }, [sourceMode, orderItems, selectedItemId]);

  // Reset per-order state when switching to a different order
  useEffect(() => {
    if (prevOrderIdRef.current !== selectedOrderId) {
      prevOrderIdRef.current = selectedOrderId;
      setSessionsByItemId({});
      setSavedEpsByItemId({});
      setSavedAnchorsByItemId({});
      setOriginalThumbsByItemId((prev) => {
        Object.values(prev).forEach((url) => URL.revokeObjectURL(url));
        return {};
      });
      setSelectedIndex(null);
    }
  }, [selectedOrderId]);

  // Load admin orders list
  useEffect(() => {
    let active = true;
    ordersService
      .listAdminOrders()
      .then((res) => {
        if (!active) return;
        setOrders(res.items);
        if (sourceMode === "order" && !urlOrderId && !selectedOrderId && res.items.length > 0) {
          setSelectedOrderId(res.items[0].id);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [sourceMode, urlOrderId, selectedOrderId]);

  // Resolve active order details
  useEffect(() => {
    if (sourceMode !== "order" || !selectedOrderId) {
      setActiveOrder(null);
      return;
    }

    const fromList = orders.find((o) => o.id === selectedOrderId);
    if (fromList) {
      setActiveOrder(fromList);
      return;
    }

    let cancelled = false;
    ordersService
      .getOrderById(selectedOrderId)
      .then((ord) => {
        if (!cancelled) setActiveOrder(ord);
      })
      .catch(() => {
        if (!cancelled) setActiveOrder(null);
      });

    return () => {
      cancelled = true;
    };
  }, [sourceMode, selectedOrderId, orders]);

  // Automatically initialize an isolated session synchronized with each order_item's shape & physical size
  useEffect(() => {
    if (sourceMode !== "order" || !activeDesignItem) return;
    const itemDims = parseItemDimensionsCm(activeDesignItem);
    setSessionsByItemId((prev) => {
      if (prev[activeDesignItem.id]) return prev;
      return {
        ...prev,
        [activeDesignItem.id]: createInitialSession(
          activeDesignItem.shape,
          navState?.dpi || 300,
          itemDims
        ),
      };
    });
  }, [sourceMode, activeDesignItem, navState?.dpi]);

  // Load Filmstrip thumbnails for every item in the active order (preferring enhanced artwork)
  const orderItemIdsKey = useMemo(
    () =>
      orderItems
        .map((it) => `${it.id}:${itemHasEnhancedArtwork(it) ? "1" : "0"}`)
        .join(","),
    [orderItems]
  );

  useEffect(() => {
    if (sourceMode !== "order" || !selectedOrderId || orderItems.length === 0) {
      setThumbsByItemId({});
      return;
    }

    let cancelled = false;
    const created: string[] = [];
    setLoadingThumbs(true);

    const loadAll = async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        orderItems.map(async (item) => {
          const preferredVersion = itemHasEnhancedArtwork(item) ? "enhanced" : "original";
          try {
            const url = await imageProcessingService.fetchOrderItemArtworkUrl(
              selectedOrderId,
              item.id,
              preferredVersion
            );
            if (cancelled) {
              URL.revokeObjectURL(url);
              return;
            }
            created.push(url);
            next[item.id] = url;
          } catch {
            // fallback icon rendered cleanly
          }
        })
      );
      if (!cancelled) {
        setThumbsByItemId(next);
        setLoadingThumbs(false);
      }
    };

    void loadAll();

    return () => {
      cancelled = true;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode, selectedOrderId, orderItemIdsKey]);

  const activeItemHasEnhanced = useMemo(
    () => itemHasEnhancedArtwork(activeDesignItem),
    [activeDesignItem]
  );

  const activeUsingEnhancedArtwork =
    sourceMode === "order" && activeItemHasEnhanced && !activeSession.useOriginalArtwork;

  const activeArtworkVariant: "enhanced" | "original" = activeUsingEnhancedArtwork
    ? "enhanced"
    : "original";

  // Lazily fetch original artwork URL when operator explicitly overrides enhanced 300 DPI default
  useEffect(() => {
    if (
      sourceMode !== "order" ||
      !selectedOrderId ||
      !activeItemId ||
      !activeItemHasEnhanced ||
      !activeSession.useOriginalArtwork ||
      originalThumbsByItemId[activeItemId]
    ) {
      return;
    }
    let cancelled = false;
    imageProcessingService
      .fetchOrderItemArtworkUrl(selectedOrderId, activeItemId, "original")
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setOriginalThumbsByItemId((prev) => ({ ...prev, [activeItemId]: url }));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    sourceMode,
    selectedOrderId,
    activeItemId,
    activeItemHasEnhanced,
    activeSession.useOriginalArtwork,
    originalThumbsByItemId,
  ]);

  useEffect(() => {
    return () => {
      if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    };
  }, [uploadPreviewUrl]);

  const hasSource =
    (sourceMode === "order" && Boolean(selectedOrderId && activeItemId)) ||
    (sourceMode === "upload" && Boolean(uploadedFile));

  const effectiveTargetWidthCm =
    params.target_width_cm && params.target_width_cm > 0
      ? params.target_width_cm
      : sourceMode === "order"
      ? fallbackItemCm?.widthCm ?? null
      : 5.0;

  const effectiveTargetHeightCm =
    params.target_height_cm && params.target_height_cm > 0
      ? params.target_height_cm
      : sourceMode === "order"
      ? fallbackItemCm?.heightCm ?? null
      : 5.0;

  const currentDetectionSignature = useMemo(
    () =>
      JSON.stringify({
        sourceMode,
        selectedOrderId,
        activeItemId,
        activeArtworkVariant,
        fileName: uploadedFile?.name ?? "",
        fileSize: uploadedFile?.size ?? 0,
        shapePreset,
        params,
        effectiveTargetWidthCm,
        effectiveTargetHeightCm,
        includeOriginalBackground: Boolean(activeSession.includeOriginalBackground),
      }),
    [
      sourceMode,
      selectedOrderId,
      activeItemId,
      activeArtworkVariant,
      uploadedFile,
      shapePreset,
      params,
      effectiveTargetWidthCm,
      effectiveTargetHeightCm,
      activeSession.includeOriginalBackground,
    ]
  );

  const runDetection = useCallback(
    async (
      nextParams: DetectEdgesParams,
      nextPreset: DieCutUiShapePreset,
      signature: string,
      silent = true
    ) => {
      if (sourceMode === "order" && (!selectedOrderId || !activeItemId)) return;
      if (sourceMode === "upload" && !uploadedFile) return;

      const seq = ++detectSeqRef.current;
      const targetMode = sourceMode;
      const targetOrderId = selectedOrderId;
      const targetItemId = activeItemId;
      const includeBg = Boolean(activeSession.includeOriginalBackground);
      const variant = activeArtworkVariant;

      const enrichedParams: DetectEdgesParams = {
        ...nextParams,
        target_width_cm:
          nextParams.target_width_cm && nextParams.target_width_cm > 0
            ? nextParams.target_width_cm
            : targetMode === "order"
            ? fallbackItemCm?.widthCm ?? null
            : 5.0,
        target_height_cm:
          nextParams.target_height_cm && nextParams.target_height_cm > 0
            ? nextParams.target_height_cm
            : targetMode === "order"
            ? fallbackItemCm?.heightCm ?? null
            : 5.0,
        fit_mode: nextParams.fit_mode ?? "contain_proportional",
      };

      setDetecting(true);
      try {
        const res =
          targetMode === "order"
            ? await imageProcessingService.detectOrderEdges(
                targetOrderId,
                enrichedParams,
                targetItemId,
                variant
              )
            : await imageProcessingService.detectUploadEdges(uploadedFile!, enrichedParams);

        const resolvedAnchors =
          nextPreset === "rectangular"
            ? buildRoundedRectAnchors(
                res.anchors,
                res.image_width,
                res.image_height,
                nextParams.corner_roundness
              )
            : nextPreset === "en_su_forma" && includeBg
            ? buildFullFrameBoundaryAnchors(
                res.image_width,
                res.image_height,
                nextParams.corner_roundness
              )
            : res.anchors;

        if (targetMode === "upload") {
          setUploadSession((prev) => ({
            ...prev,
            result: res,
            anchors: resolvedAnchors,
            history: [],
            future: [],
            detectionSignature: signature,
          }));
        } else if (targetItemId) {
          const persistedServerAnchors =
            silent ? parseSavedBezierAnchors(activeDesignItem?.die_cut_anchors_json) : null;
          setSessionsByItemId((prev) => {
            const base =
              prev[targetItemId] ??
              createInitialSession(activeDesignItem?.shape, navState?.dpi || 300, fallbackItemCm);
            const isFirstDetection = !base.result;
            const initialAnchors =
              isFirstDetection && persistedServerAnchors && persistedServerAnchors.length >= 3
                ? persistedServerAnchors
                : resolvedAnchors;
            return {
              ...prev,
              [targetItemId]: {
                ...base,
                result: res,
                anchors: initialAnchors,
                history: [],
                future: [],
                detectionSignature: signature,
              },
            };
          });
        }

        if (seq === detectSeqRef.current) {
          setSelectedIndex(null);
          if (!silent) {
            pushToast({
              title: "Trazado de troquel actualizado",
              description: `${resolvedAnchors.length} nodos · ${
                res.cut_direction === "inside" ? "Corte interior" : "Corte exterior"
              }${
                nextParams.white_border_mm > 0
                  ? ` · Margen blanco +${nextParams.white_border_mm.toFixed(1)} mm`
                  : ""
              }`,
              variant: "success",
            });
          }
        }
      } catch (err) {
        if (seq === detectSeqRef.current) {
          pushToast({
            title: "Error generando troquelado",
            description: err instanceof Error ? err.message : undefined,
            variant: "error",
          });
        }
      } finally {
        if (seq === detectSeqRef.current) {
          setDetecting(false);
        }
      }
    },
    [
      sourceMode,
      selectedOrderId,
      activeItemId,
      uploadedFile,
      activeDesignItem?.shape,
      activeDesignItem?.die_cut_anchors_json,
      navState?.dpi,
      fallbackItemCm,
      activeSession.includeOriginalBackground,
      activeArtworkVariant,
      pushToast,
    ]
  );

  // Auto-run detection ONLY when active item's geometry signature differs from its cached detection
  // (Switching back to a previously edited design preserves its manual Bezier edits!)
  useEffect(() => {
    if (!hasSource) return;
    if (activeSession.result && activeSession.detectionSignature === currentDetectionSignature) {
      return;
    }

    const timer = window.setTimeout(() => {
      void runDetection(params, shapePreset, currentDetectionSignature, true);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [
    hasSource,
    activeSession.result,
    activeSession.detectionSignature,
    currentDetectionSignature,
    params,
    shapePreset,
    runDetection,
  ]);

  const handleSelectShapePreset = (preset: DieCutUiShapePreset) => {
    updateActiveSession((prev) => {
      if (preset === "circular") {
        return { ...prev, shapePreset: preset, params: { ...prev.params, mode: "circular" } };
      }
      if (preset === "rectangular") {
        return { ...prev, shapePreset: preset, params: { ...prev.params, mode: "en_su_forma" } };
      }
      if (preset === "cuadrado") {
        return {
          ...prev,
          shapePreset: preset,
          params: {
            ...prev.params,
            mode: "poligono_regular",
            polygon_sides: 4,
            polygon_rotation_deg: 0,
          },
        };
      }
      if (preset === "poligono_regular") {
        return {
          ...prev,
          shapePreset: preset,
          params: {
            ...prev.params,
            mode: "poligono_regular",
            polygon_sides: prev.params.polygon_sides === 4 ? 6 : prev.params.polygon_sides,
          },
        };
      }
      return { ...prev, shapePreset: "en_su_forma", params: { ...prev.params, mode: "en_su_forma" } };
    });
  };

  const handleSelectDesignItem = (item: OrderDesignItemResponse) => {
    setSelectedItemId(item.id);
    setSelectedIndex(null);
    if (selectedOrderId) {
      setSearchParams({ orderId: selectedOrderId, itemId: item.id }, { replace: true });
    }
  };

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

  const handleAnchorsChange = useCallback(
    (next: BezierAnchor[], pushHistory = false) => {
      updateActiveSession((prev) => ({
        ...prev,
        history: pushHistory ? [...prev.history.slice(-39), prev.anchors] : prev.history,
        future: pushHistory ? [] : prev.future,
        anchors: next,
      }));
    },
    [updateActiveSession]
  );

  const handleUndo = useCallback(() => {
    updateActiveSession((prev) => {
      if (prev.history.length === 0) return prev;
      const previous = prev.history[prev.history.length - 1];
      return {
        ...prev,
        history: prev.history.slice(0, -1),
        future: [prev.anchors, ...prev.future.slice(0, 39)],
        anchors: previous,
      };
    });
    setSelectedIndex(null);
  }, [updateActiveSession]);

  const handleRedo = useCallback(() => {
    updateActiveSession((prev) => {
      if (prev.future.length === 0) return prev;
      const next = prev.future[0];
      return {
        ...prev,
        history: [...prev.history.slice(-39), prev.anchors],
        future: prev.future.slice(1),
        anchors: next,
      };
    });
    setSelectedIndex(null);
  }, [updateActiveSession]);

  const handleSmoothAllVertices = () => {
    if (anchors.length < 3) return;
    const rounded = recomputeRoundedHandles(anchors, Math.max(0.25, params.corner_roundness));
    handleAnchorsChange(rounded, true);
    pushToast({
      title: "Vértices redondeados",
      description: "Se suavizaron todas las curvas Bézier para corte limpio en plotter.",
      variant: "info",
    });
  };

  const handleToggleSelectedSmooth = () => {
    if (selectedIndex === null || !anchors[selectedIndex]) return;
    const next = toggleAnchorSmoothCorner(
      anchors,
      selectedIndex,
      Math.max(0.25, params.corner_roundness)
    );
    handleAnchorsChange(next, true);
  };

  const projectedSimplifiedNodes = useMemo(
    () =>
      previewSimplifiedNodeCount(
        anchors,
        simplifyIntensity,
        Math.max(0.25, params.corner_roundness)
      ),
    [anchors, simplifyIntensity, params.corner_roundness]
  );

  const handleApplySimplifyPath = () => {
    if (anchors.length <= 3 || simplifyIntensity <= 0 || cutLayerLocked) return;
    const beforeCount = anchors.length;
    const simplified = simplifyBezierContour(
      anchors,
      simplifyIntensity,
      Math.max(0.25, params.corner_roundness)
    );
    handleAnchorsChange(simplified, true);
    setSelectedIndex(null);
    pushToast({
      title: "Trazado simplificado",
      description: `${beforeCount} nodos → ${simplified.length} nodos (${simplifyIntensity}% intensidad · Ctrl+Z para deshacer).`,
      variant: "info",
    });
  };

  const handleDeleteSelectedAnchor = () => {
    if (selectedIndex === null || anchors.length <= 3) return;
    const next = anchors.filter((_, idx) => idx !== selectedIndex);
    handleAnchorsChange(next, true);
    setSelectedIndex(Math.min(selectedIndex, next.length - 1));
  };

  const handleUploadChange = (file: File | null) => {
    if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    setUploadedFile(file);
    setUploadPreviewUrl(file ? URL.createObjectURL(file) : null);
    setUploadSession(
      createInitialSession(undefined, params.dpi, {
        widthCm: effectiveTargetWidthCm ?? 5,
        heightCm: effectiveTargetHeightCm ?? 5,
      })
    );
    setSelectedIndex(null);
  };

  const handleToggleIncludeOriginalBackground = () => {
    updateActiveSession((prev) => {
      const nextInclude = !prev.includeOriginalBackground;
      const imgW = prev.result?.image_width ?? 400;
      const imgH = prev.result?.image_height ?? 400;
      const nextAnchors =
        nextInclude && prev.result
          ? buildFullFrameBoundaryAnchors(imgW, imgH, prev.params.corner_roundness)
          : prev.result?.anchors ?? prev.anchors;
      return {
        ...prev,
        includeOriginalBackground: nextInclude,
        params: {
          ...prev.params,
          remove_background: nextInclude ? false : prev.params.remove_background,
        },
        anchors: nextAnchors,
      };
    });
  };

  const handleToggleArtworkVariant = () => {
    if (!activeItemHasEnhanced) return;
    const nextUseOriginal = !activeSession.useOriginalArtwork;
    updateActiveSession((prev) => ({
      ...prev,
      useOriginalArtwork: nextUseOriginal,
    }));
    pushToast({
      title: nextUseOriginal
        ? "Cambiado a Arte Original"
        : "Usando Arte Mejorado 300 DPI",
      description: nextUseOriginal
        ? "Visualizando y troquelando sobre la imagen original sin mejorar."
        : "Visualizando y troquelando sobre la versión mejorada de preprensa (300 DPI).",
      variant: nextUseOriginal ? "info" : "success",
    });
  };

  const hasItemSavedEps = useCallback(
    (item: OrderDesignItemResponse): boolean =>
      Boolean(item.die_cut_eps_path) ||
      Boolean(savedEpsByItemId[item.id]) ||
      item.prepress_status === "troquelado" ||
      item.prepress_status === "listo_pliego",
    [savedEpsByItemId]
  );

  const hasItemSavedDieCut = useCallback(
    (item: OrderDesignItemResponse): boolean =>
      hasItemSavedEps(item) ||
      Boolean(item.die_cut_anchors_json) ||
      Boolean(savedAnchorsByItemId[item.id]),
    [hasItemSavedEps, savedAnchorsByItemId]
  );

  const epsReadyCount = useMemo(
    () => orderItems.filter((it) => hasItemSavedEps(it)).length,
    [orderItems, hasItemSavedEps]
  );

  const dieCutSavedCount = useMemo(
    () => orderItems.filter((it) => hasItemSavedDieCut(it)).length,
    [orderItems, hasItemSavedDieCut]
  );

  const enhancedItemsCount = useMemo(
    () => orderItems.filter((it) => itemHasEnhancedArtwork(it)).length,
    [orderItems]
  );

  const unenhancedOrderItems = useMemo(
    () => orderItems.filter((it) => !itemHasEnhancedArtwork(it)),
    [orderItems]
  );

  const isRollOrder = useMemo(
    () =>
      orderItems.some((it) => it.vinyl_gloss_mode === "En rollo") ||
      activeOrder?.vinyl_gloss_mode === "En rollo",
    [orderItems, activeOrder?.vinyl_gloss_mode]
  );

  const activeCanvasArtworkUrl = useMemo(() => {
    if (
      sourceMode === "order" &&
      activeItemHasEnhanced &&
      activeSession.useOriginalArtwork &&
      activeItemId &&
      originalThumbsByItemId[activeItemId]
    ) {
      return originalThumbsByItemId[activeItemId];
    }
    if (
      shapePreset === "en_su_forma" &&
      activeSession.includeOriginalBackground
    ) {
      if (sourceMode === "upload" && uploadPreviewUrl) return uploadPreviewUrl;
      if (sourceMode === "order" && activeItemId && thumbsByItemId[activeItemId]) {
        return thumbsByItemId[activeItemId];
      }
    }
    return result?.artwork_data_url ?? null;
  }, [
    sourceMode,
    activeItemHasEnhanced,
    activeSession.useOriginalArtwork,
    activeItemId,
    originalThumbsByItemId,
    shapePreset,
    activeSession.includeOriginalBackground,
    uploadPreviewUrl,
    thumbsByItemId,
    result?.artwork_data_url,
  ]);

  const handleSaveDieCutToCurrentItem = async () => {
    if (sourceMode !== "order" || !selectedOrderId || !activeItemId || !result || anchors.length < 3) {
      return;
    }
    setExporting("save-diecut");
    try {
      const designSuffix =
        isMultiDesignOrder && activeDesignItem ? `-D${activeDesignItem.position}` : "";
      const title = `${activeOrder?.order_number || result.source_label}${designSuffix}`;

      await imageProcessingService.saveDieCutToOrderItem({
        orderId: selectedOrderId,
        itemId: activeItemId,
        artworkDataUrl: result.artwork_data_url,
        title,
        imageWidth: result.image_width,
        imageHeight: result.image_height,
        dpi: result.dpi,
        anchors,
        borderColor: activeBorderColor,
        cutDirection: params.cut_direction,
        borderWidthMm,
        borderCutPosition,
        borderOffsetMm,
        cutStrokeWidthPt,
        targetWidthCm: effectiveTargetWidthCm,
        targetHeightCm: effectiveTargetHeightCm,
        fitMode: params.fit_mode ?? "contain_proportional",
      });

      setSavedEpsByItemId((prev) => ({ ...prev, [activeItemId]: true }));
      setSavedAnchorsByItemId((prev) => ({ ...prev, [activeItemId]: true }));

      try {
        const refreshed = await ordersService.getOrderById(selectedOrderId);
        setActiveOrder(refreshed);
        setOrders((prev) => prev.map((o) => (o.id === refreshed.id ? refreshed : o)));
      } catch {
        // local flags already updated
      }

      pushToast({
        title: activeDesignItem
          ? `Troquel guardado en Diseño #${activeDesignItem.position}`
          : "Troquel guardado en el diseño",
        description:
          "Anclas Bézier y archivo .EPS de 2 capas guardados en el pedido. Puedes pasar al siguiente diseño del Filmstrip.",
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: "No se pudo guardar el troquel en este diseño",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setExporting(null);
    }
  };

  const handleExportProduction = async (format: "eps" | "pdf") => {
    if (sourceMode !== "order" || !activeOrder) return;
    const key = `prod-${format}`;
    setExporting(key);
    try {
      const suffix =
        format === "pdf"
          ? "mesas_separadas.pdf"
          : isRollOrder
          ? "carriles_rollo.eps"
          : "hoja_produccion.eps";
      const res = await imageProcessingService.exportOrderProduction(
        activeOrder.id,
        format,
        `${activeOrder.order_number}_${suffix}`
      );
      pushToast({
        title:
          format === "pdf"
            ? "Mesas separadas (.PDF) exportadas"
            : isRollOrder
            ? "Carriles en rollo (.EPS) exportados"
            : "Trabajo en 1 hoja (.EPS) exportado",
        description: `${res.filename} listo para Adobe Illustrator / Plotter (${enhancedItemsCount}/${orderItems.length} con arte 300 DPI).`,
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: `Error al exportar producción (.${format.toUpperCase()})`,
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setExporting(null);
    }
  };

  const handleExport = async (
    format: "eps" | "svg",
    advanceStatus?: "Troquelado" | "Listo"
  ) => {
    if (!result || anchors.length < 3) return;
    const key = `${format}-${advanceStatus || "only"}`;
    setExporting(key);
    try {
      const designSuffix =
        sourceMode === "order" && isMultiDesignOrder && activeDesignItem
          ? `-D${activeDesignItem.position}`
          : "";
      const title =
        sourceMode === "order"
          ? `${activeOrder?.order_number || result.source_label}${designSuffix}`
          : result.source_label.replace(/\.[^.]+$/, "");

      await imageProcessingService.exportDieCutFile({
        orderId: sourceMode === "order" ? selectedOrderId : null,
        itemId: sourceMode === "order" ? activeItemId : null,
        artworkDataUrl: result.artwork_data_url,
        title,
        imageWidth: result.image_width,
        imageHeight: result.image_height,
        dpi: result.dpi,
        anchors,
        exportFormat: format,
        advanceStatus: sourceMode === "order" ? advanceStatus : null,
        borderColor: activeBorderColor,
        cutDirection: params.cut_direction,
        borderWidthMm,
        borderCutPosition,
        borderOffsetMm,
        cutStrokeWidthPt,
        targetWidthCm: effectiveTargetWidthCm,
        targetHeightCm: effectiveTargetHeightCm,
        fitMode: params.fit_mode ?? "contain_proportional",
      });

      if (sourceMode === "order" && selectedOrderId) {
        if (format === "eps" && activeItemId) {
          setSavedEpsByItemId((prev) => ({ ...prev, [activeItemId]: true }));
        }
        // Sync persisted die_cut_eps_path, prepress_status & order status from backend
        try {
          const refreshed = await ordersService.getOrderById(selectedOrderId);
          setActiveOrder(refreshed);
          setOrders((prev) => prev.map((o) => (o.id === refreshed.id ? refreshed : o)));
        } catch {
          if (advanceStatus && activeOrder) {
            setActiveOrder({ ...activeOrder, status: advanceStatus });
          }
        }
      }

      const designTag =
        sourceMode === "order" && isMultiDesignOrder && activeDesignItem
          ? ` (Diseño #${activeDesignItem.position})`
          : "";
      pushToast({
        title: `Archivo ${format.toUpperCase()} de 2 capas exportado${designTag}`,
        description:
          format === "eps" && sourceMode === "order"
            ? "Troquel .EPS guardado en el diseño · Disponible en el paquete .ZIP del pedido."
            : "Capa 1 (Diseño CMYK) + Capa 2 (Corte CutContour) listos para Illustrator / Plotter.",
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: `Error al exportar ${format.toUpperCase()}`,
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setExporting(null);
    }
  };

  const handleExportOrderZip = async () => {
    if (sourceMode !== "order" || !activeOrder || epsReadyCount === 0) return;
    setExporting("zip");
    try {
      const res = await imageProcessingService.exportOrderZip(
        activeOrder.id,
        `${activeOrder.order_number}_preprensa.zip`
      );
      pushToast({
        title: `Paquete .ZIP descargado (${res.packagedItems || epsReadyCount}/${
          res.totalItems || orderItems.length
        } diseños)`,
        description: `${res.filename} con todos los .EPS troquelados listos para producción.`,
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: "No se pudo descargar el paquete .ZIP",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setExporting(null);
    }
  };

  const selectedAnchor = selectedIndex !== null ? anchors[selectedIndex] ?? null : null;

  // Compute physical canvas & CutContour dimensions in real centimeters (backend values + live anchor edits)
  const { canvasPhysicalWidthCm, canvasPhysicalHeightCm, cutWidthCm, cutHeightCm } = useMemo(() => {
    const imgW = Math.max(1, result?.image_width ?? 400);
    const imgH = Math.max(1, result?.image_height ?? 400);
    const liveBBox = measureBezierContourBBoxPx(anchors, imgW, imgH);
    const detectedBBox = measureBezierContourBBoxPx(result?.anchors ?? anchors, imgW, imgH);
    const activeFitMode: DieCutFitMode = params.fit_mode ?? "contain_proportional";

    // 1. If backend returned calibrated cut_width_cm & cut_height_cm, use them and scale live on node drag
    if (
      result?.cut_width_cm &&
      result.cut_width_cm > 0 &&
      result?.cut_height_cm &&
      result.cut_height_cm > 0 &&
      result.physical_width_cm > 0 &&
      result.physical_height_cm > 0
    ) {
      const ratioW = liveBBox.widthPx / Math.max(1, detectedBBox.widthPx);
      const ratioH = liveBBox.heightPx / Math.max(1, detectedBBox.heightPx);
      return {
        canvasPhysicalWidthCm: result.physical_width_cm,
        canvasPhysicalHeightCm: result.physical_height_cm,
        cutWidthCm: round2(result.cut_width_cm * ratioW),
        cutHeightCm: round2(result.cut_height_cm * ratioH),
      };
    }

    // 2. Calibrate against target order_item / upload dimensions (cm) & fit_mode
    if (
      effectiveTargetWidthCm &&
      effectiveTargetWidthCm > 0 &&
      effectiveTargetHeightCm &&
      effectiveTargetHeightCm > 0
    ) {
      if (activeFitMode === "exact_stretch") {
        const ratioW = liveBBox.widthPx / Math.max(1, detectedBBox.widthPx);
        const ratioH = liveBBox.heightPx / Math.max(1, detectedBBox.heightPx);
        return {
          canvasPhysicalWidthCm: round2(effectiveTargetWidthCm),
          canvasPhysicalHeightCm: round2(effectiveTargetHeightCm),
          cutWidthCm: round2(effectiveTargetWidthCm * ratioW),
          cutHeightCm: round2(effectiveTargetHeightCm * ratioH),
        };
      }

      // Proportional ("contain_proportional"): fit CutContour proportionally inside targetWidth x targetHeight
      const cmPerPx = Math.min(
        effectiveTargetWidthCm / Math.max(1, detectedBBox.widthPx),
        effectiveTargetHeightCm / Math.max(1, detectedBBox.heightPx)
      );
      return {
        canvasPhysicalWidthCm: round2(imgW * cmPerPx),
        canvasPhysicalHeightCm: round2(imgH * cmPerPx),
        cutWidthCm: round2(liveBBox.widthPx * cmPerPx),
        cutHeightCm: round2(liveBBox.heightPx * cmPerPx),
      };
    }

    // 3. Fallback to raw result physical_width_cm / physical_height_cm
    const rawPhysW =
      result?.physical_width_cm && result.physical_width_cm > 0
        ? result.physical_width_cm
        : round2((imgW / Math.max(72, params.dpi)) * 2.54);
    const rawPhysH =
      result?.physical_height_cm && result.physical_height_cm > 0
        ? result.physical_height_cm
        : round2((imgH / Math.max(72, params.dpi)) * 2.54);

    return {
      canvasPhysicalWidthCm: rawPhysW,
      canvasPhysicalHeightCm: rawPhysH,
      cutWidthCm: round2((liveBBox.widthPx / imgW) * rawPhysW),
      cutHeightCm: round2((liveBBox.heightPx / imgH) * rawPhysH),
    };
  }, [
    result,
    anchors,
    params.fit_mode,
    params.dpi,
    effectiveTargetWidthCm,
    effectiveTargetHeightCm,
  ]);

  const enhancerReturnHref =
    sourceMode === "order" && selectedOrderId
      ? `/dashboard/image-enhancer?orderId=${selectedOrderId}${
          activeItemId && !activeItemId.startsWith("legacy-") ? `&itemId=${activeItemId}` : ""
        }`
      : "/dashboard/image-enhancer";

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
              <Link
                to={enhancerReturnHref}
                className="inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-ink-secondary transition-colors duration-fast hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                <span>Calidad</span>
              </Link>
              <span
                aria-current="page"
                className="inline-flex items-center gap-1 rounded-sm bg-accent px-2.5 py-1 text-accent-ink shadow-xs"
              >
                <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Troquel</span>
              </span>
            </nav>

            <div
              role="group"
              aria-label="Origen del diseño"
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
                <span>PNG</span>
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
              variant="outline"
              size="sm"
              disabled={!hasSource}
              loading={detecting}
              onClick={() =>
                void runDetection(params, shapePreset, currentDetectionSignature, false)
              }
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              Recalcular
            </Button>

            {sourceMode === "order" && activeOrder && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!result || anchors.length < 3}
                loading={exporting === "save-diecut"}
                onClick={() => void handleSaveDieCutToCurrentItem()}
                title="Guardar anclas y .EPS en este diseño"
                leftIcon={<Save className="h-3.5 w-3.5 text-accent" />}
              >
                Guardar
              </Button>
            )}

            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!result || anchors.length < 3}
              loading={exporting === "eps-only"}
              onClick={() => void handleExport("eps")}
              leftIcon={<Download className="h-3.5 w-3.5" />}
            >
              Exportar .EPS
            </Button>
          </div>
        </div>

        {sourceMode === "upload" && (
          <div className="mt-2 border-t border-dashed border-line-subtle pt-2">
            <StickerDropzone
              file={uploadedFile}
              previewUrl={uploadPreviewUrl}
              onFileChange={handleUploadChange}
            />
          </div>
        )}
      </div>

      {/* Main Fixed-Viewport Studio Workspace */}
      <div className="grid grid-cols-1 gap-2.5 lg:min-h-0 lg:flex-1 lg:grid-cols-12 lg:overflow-hidden">
        {/* Left/Center: Full-Height Column (Compact Order/Filmstrip + ~80% Vector Artboard) */}
        <div className="flex h-full min-h-0 flex-col gap-2 lg:col-span-8 lg:overflow-hidden xl:col-span-9">
          {/* Compact Single-Row Order + Filmstrip Bar (~56px) separated in 3 non-overlapping zones */}
          {sourceMode === "order" && activeOrder && (
            <section
              aria-label="Pedido y diseños para troquelado"
              className="shrink-0 rounded-sticker border border-line-subtle bg-surface-card px-2.5 py-1.5 shadow-card"
            >
              <div className="flex items-center justify-between gap-3">
                {/* Zone A (Left, shrink-0): Order Code + Client Name + Status */}
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-xs border border-line-diecut/50 bg-accent-soft/60 px-1.5 py-0.5 font-mono text-[11px] font-extrabold text-accent">
                    {activeOrder.order_number}
                  </span>
                  <span className="max-w-[120px] truncate font-display text-xs font-extrabold text-ink-primary sm:max-w-[165px]">
                    {activeOrder.referral_name}
                  </span>
                  <StickerBadge status={activeOrder.status} size="sm" />
                </div>

                {/* Zone B (Center, flex-1 min-w-0): Clean Design Chips Selector */}
                <div
                  role="tablist"
                  aria-label="Diseños del pedido para troquelado"
                  title="Selecciona un diseño (← / →)"
                  className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1"
                >
                  {orderItems.map((item, idx) => {
                    const isActive = item.id === activeItemId;
                    const hasSavedDieCut = hasItemSavedDieCut(item);
                    const thumbSrc =
                      sessionsByItemId[item.id]?.result?.artwork_data_url ??
                      thumbsByItemId[item.id] ??
                      null;

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
                        title={`#${item.position} · ${item.shape} · ${item.size_display} · x${item.quantity}${hasSavedDieCut ? " · Guardado" : ""}`}
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
                          ) : loadingThumbs ? (
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
                            {hasSavedDieCut ? (
                              <CheckCircle2
                                className="h-3 w-3 text-preflight-ok-dot"
                                aria-hidden="true"
                              />
                            ) : (
                              <span
                                className="h-1.5 w-1.5 rounded-full bg-line-strong"
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

                {/* Zone C (Right, shrink-0): Artwork Source Pill + Counter + Action */}
                <div className="flex shrink-0 items-center gap-1.5">
                  {activeItemHasEnhanced ? (
                    <button
                      type="button"
                      onClick={handleToggleArtworkVariant}
                      title={
                        activeUsingEnhancedArtwork
                          ? "Usando arte mejorado 300 DPI · Clic para ver original"
                          : "Viendo arte original · Clic para volver a arte mejorado 300 DPI"
                      }
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        activeUsingEnhancedArtwork
                          ? "border-preflight-ok-border bg-preflight-ok-bg text-preflight-ok-ink"
                          : "border-preflight-warn-border bg-preflight-warn-bg text-preflight-warn-ink"
                      }`}
                    >
                      {activeUsingEnhancedArtwork ? (
                        <Sparkles className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      )}
                      <span>{activeUsingEnhancedArtwork ? "300 DPI" : "Original"}</span>
                    </button>
                  ) : (
                    <Link
                      to={enhancerReturnHref}
                      title="Arte original sin mejorar · Abrir Lab CMYK"
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-preflight-warn-border bg-preflight-warn-bg px-2 py-0.5 font-mono text-[10px] font-bold text-preflight-warn-ink hover:opacity-90"
                    >
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      <span>Sin mejora</span>
                    </Link>
                  )}

                  <span
                    className="rounded-full border border-line-subtle bg-surface-elevated px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums text-ink-secondary"
                    title="Troqueles guardados en el pedido"
                  >
                    {dieCutSavedCount}/{orderItems.length}
                  </span>

                  <Button
                    type="button"
                    size="sm"
                    variant="inverted"
                    disabled={!result || anchors.length < 3}
                    loading={exporting === "eps-Troquelado"}
                    onClick={() => void handleExport("eps", "Troquelado")}
                    title="Exportar .EPS y marcar pedido como Troquelado"
                    leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  >
                    Troquelado
                  </Button>
                </div>
              </div>
            </section>
          )}

          {/* Full-Height Vector Artboard (~80% height) */}
          <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
            <DieCutVectorCanvas
              artworkUrl={activeCanvasArtworkUrl}
              imageWidth={result?.image_width ?? 400}
              imageHeight={result?.image_height ?? 400}
              dpi={result?.dpi ?? params.dpi}
              physicalWidthCm={canvasPhysicalWidthCm}
              physicalHeightCm={canvasPhysicalHeightCm}
              cutWidthCm={cutWidthCm}
              cutHeightCm={cutHeightCm}
              targetWidthCm={effectiveTargetWidthCm}
              targetHeightCm={effectiveTargetHeightCm}
              fitMode={params.fit_mode ?? "contain_proportional"}
              targetSizeDisplay={sourceMode === "order" ? activeSizeDisplay : null}
              whiteBorderMm={params.white_border_mm}
              bleedMm={params.bleed_mm}
              cutDirection={params.cut_direction}
              cutContourTone={cutContourTone}
              onCutContourToneChange={setCutContourTone}
              borderColor={activeBorderColor}
              borderWidthMm={borderWidthMm}
              borderCutPosition={borderCutPosition}
              borderOffsetMm={borderOffsetMm}
              cutStrokeWidthPt={cutStrokeWidthPt}
              anchors={anchors}
              selectedIndex={selectedIndex}
              onSelectIndex={setSelectedIndex}
              onChangeAnchors={handleAnchorsChange}
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={history.length > 0}
              canRedo={future.length > 0}
              showDesignLayer={showDesignLayer}
              designOpacity={designOpacity}
              showCutLayer={showCutLayer}
              cutLayerLocked={cutLayerLocked}
              dashedPreview={dashedPreview}
              showPoints={showPoints}
              onToggleShowPoints={() => setShowPoints((v) => !v)}
              loading={detecting}
              onSmoothAllVertices={handleSmoothAllVertices}
            />
          </div>
        </div>

        {/* Right: Independent-Scroll Tool Sidebar with Fixed Tab Bar (Forma | Trazado | Exportar) */}
        <aside className="flex flex-col overflow-hidden rounded-sticker border border-line-subtle bg-surface-card shadow-card lg:col-span-4 lg:h-full lg:min-h-0 xl:col-span-3">
          {/* Fixed Sidebar Tab Bar */}
          <div
            role="tablist"
            aria-label="Herramientas de troquelado"
            className="grid shrink-0 grid-cols-3 gap-1 border-b border-line-subtle bg-surface-elevated/80 p-1.5"
          >
            {(
              [
                { id: "forma", label: "Forma", icon: Scissors },
                { id: "trazado", label: "Trazado", icon: Layers },
                { id: "exportar", label: "Exportar", icon: Download },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const isActive = activeToolTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveToolTab(tab.id)}
                  className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-extrabold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isActive
                      ? "bg-accent text-accent-ink shadow-xs"
                      : "text-ink-secondary hover:bg-surface-card hover:text-ink-primary"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Independent Scrollable Tool Body */}
          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {/* TAB: EXPORTAR (Individual 2-Layer .EPS/.SVG + Smart Multi-Design Production Export) */}
            {activeToolTab === "exportar" && (
              <div className="space-y-3">
                {/* Real Physical Dimensions (cm) & Discrete Scale Fit Mode Selector */}
                <div className="space-y-2.5 rounded-lg border border-line-subtle bg-surface-elevated/55 p-3">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="flex items-center gap-1.5 font-extrabold text-ink-primary">
                      <Ruler className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                      <span>Medidas del Pedido (.EPS)</span>
                    </span>
                    <span className="rounded-xs border border-line-diecut/60 bg-surface-card px-1.5 py-0.5 font-mono text-[10px] font-extrabold tabular-nums text-accent">
                      {sourceMode === "order" && activeSizeDisplay
                        ? `Pedido ${activeSizeDisplay}`
                        : `${formatCmLabel(effectiveTargetWidthCm)}×${formatCmLabel(
                            effectiveTargetHeightCm
                          )} cm`}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1 text-[10px] font-semibold text-ink-secondary">
                      <span className="block">Ancho objetivo (cm)</span>
                      <input
                        type="number"
                        min={0.5}
                        max={500}
                        step={0.1}
                        aria-label="Ancho físico objetivo en centímetros"
                        value={effectiveTargetWidthCm ?? ""}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          updateActiveSession((prev) => ({
                            ...prev,
                            params: {
                              ...prev.params,
                              target_width_cm: Number.isFinite(val) && val > 0 ? val : null,
                            },
                          }));
                        }}
                        className="h-8 w-full rounded-md border border-line-subtle bg-surface-card px-2 font-mono text-xs font-bold tabular-nums text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </label>

                    <label className="space-y-1 text-[10px] font-semibold text-ink-secondary">
                      <span className="block">Alto objetivo (cm)</span>
                      <input
                        type="number"
                        min={0.5}
                        max={500}
                        step={0.1}
                        aria-label="Alto físico objetivo en centímetros"
                        value={effectiveTargetHeightCm ?? ""}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          updateActiveSession((prev) => ({
                            ...prev,
                            params: {
                              ...prev.params,
                              target_height_cm: Number.isFinite(val) && val > 0 ? val : null,
                            },
                          }));
                        }}
                        className="h-8 w-full rounded-md border border-line-subtle bg-surface-card px-2 font-mono text-xs font-bold tabular-nums text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </label>
                  </div>

                  <div className="space-y-1">
                    <span className="block text-[10px] font-semibold text-ink-secondary">
                      Ajuste de escala al tamaño objetivo
                    </span>
                    <div
                      role="group"
                      aria-label="Modo de ajuste de escala"
                      className="grid grid-cols-1 gap-1 text-[10px] font-bold"
                    >
                      {(
                        [
                          {
                            id: "contain_proportional",
                            label: "Proporcional (recomendado)",
                            hint: "Mantiene la proporción original sin deformar el arte",
                          },
                          {
                            id: "exact_stretch",
                            label: "Medida exacta (sin bordes extra)",
                            hint: "Ajusta el troquel exactamente al ancho y alto indicados",
                          },
                        ] as { id: DieCutFitMode; label: string; hint: string }[]
                      ).map((opt) => {
                        const active = (params.fit_mode ?? "contain_proportional") === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            aria-pressed={active}
                            title={opt.hint}
                            onClick={() =>
                              updateActiveSession((prev) => ({
                                ...prev,
                                params: { ...prev.params, fit_mode: opt.id },
                              }))
                            }
                            className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-left transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              active
                                ? "border-accent bg-accent text-accent-ink shadow-xs"
                                : "border-line-subtle bg-surface-card text-ink-secondary hover:border-line-diecut hover:text-ink-primary"
                            }`}
                          >
                            <span>{opt.label}</span>
                            {active && (
                              <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Export 2-Layer .EPS / .SVG (Active Item) & Smart Multi-Design Production Export */}
                <div className="space-y-3">
                  <div className="flex flex-col gap-2.5 rounded-lg border border-dashed border-line-diecut bg-accent-soft/45 p-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-bold text-ink-primary">
                        <Scissors className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                        <span>
                          Troquel 2 Capas
                          {sourceMode === "order" && isMultiDesignOrder && activeDesignItem
                            ? ` · #${activeDesignItem.position}`
                            : ""}
                        </span>
                      </span>
                      <span className="font-mono text-[10px] text-ink-secondary">
                        {cutStrokeWidthPt.toFixed(2)} pt · {anchors.length} nodos
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {sourceMode === "order" && activeOrder && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={!result || anchors.length < 3}
                          loading={exporting === "save-diecut"}
                          onClick={() => void handleSaveDieCutToCurrentItem()}
                          leftIcon={<Save className="h-3.5 w-3.5 text-accent" />}
                        >
                          Guardar
                        </Button>
                      )}

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!result || anchors.length < 3}
                        loading={exporting === "svg-only"}
                        onClick={() => void handleExport("svg")}
                        leftIcon={<FileCode2 className="h-3.5 w-3.5" />}
                      >
                        .SVG
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        disabled={!result || anchors.length < 3}
                        loading={exporting === "eps-only"}
                        onClick={() => void handleExport("eps")}
                        leftIcon={<Download className="h-3.5 w-3.5" />}
                      >
                        Exportar .EPS
                      </Button>

                      {sourceMode === "order" && activeOrder && (
                        <Button
                          type="button"
                          size="sm"
                          variant="inverted"
                          disabled={!result || anchors.length < 3}
                          loading={exporting === "eps-Troquelado"}
                          onClick={() => void handleExport("eps", "Troquelado")}
                          leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
                        >
                          .EPS → Troquelado
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Smart Production Export for Orders with 2 or more designs */}
                  {sourceMode === "order" && activeOrder && orderItems.length >= 2 && (
                    <div className="space-y-2.5 rounded-lg border border-line-subtle bg-surface-elevated/70 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className="inline-flex items-center gap-1.5 font-display text-xs font-extrabold uppercase tracking-wider text-ink-primary">
                          {isRollOrder ? (
                            <Scroll className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                          ) : (
                            <Layers className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                          )}
                          <span>Producción ({orderItems.length})</span>
                        </span>
                        <span className="rounded-full border border-line-diecut/60 bg-accent-soft/70 px-2 py-0.5 font-mono text-[10px] font-bold text-accent">
                          {isRollOrder ? "En rollo" : "Hoja / Corte"}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
                            enhancedItemsCount === orderItems.length
                              ? "border-preflight-ok-border bg-preflight-ok-bg text-preflight-ok-ink"
                              : "border-preflight-warn-border bg-preflight-warn-bg text-preflight-warn-ink"
                          }`}
                        >
                          <Sparkles className="h-3 w-3" aria-hidden="true" />
                          <span>
                            300 DPI: {enhancedItemsCount}/{orderItems.length}
                          </span>
                        </span>

                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
                            dieCutSavedCount === orderItems.length
                              ? "border-preflight-ok-border bg-preflight-ok-bg text-preflight-ok-ink"
                              : "border-line-subtle bg-surface-card text-ink-secondary"
                          }`}
                        >
                          <Scissors className="h-3 w-3 text-accent" aria-hidden="true" />
                          <span>
                            Troquel: {dieCutSavedCount}/{orderItems.length}
                          </span>
                        </span>
                      </div>

                      {unenhancedOrderItems.length > 0 && (
                        <div
                          role="status"
                          className="flex items-center justify-between gap-2 rounded-md border border-preflight-warn-border bg-preflight-warn-bg/85 px-2.5 py-1.5 text-[11px] text-preflight-warn-ink"
                        >
                          <span className="truncate font-semibold">
                            Sin mejorar: {unenhancedOrderItems.map((it) => `#${it.position}`).join(", ")}
                          </span>
                          <Link
                            to={enhancerReturnHref}
                            className="shrink-0 font-mono text-[10px] font-extrabold underline hover:opacity-80"
                          >
                            Lab CMYK →
                          </Link>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-1.5">
                        {!isRollOrder ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="primary"
                              loading={exporting === "prod-eps"}
                              onClick={() => void handleExportProduction("eps")}
                              leftIcon={<Download className="h-3.5 w-3.5" />}
                            >
                              1 hoja (.EPS)
                            </Button>

                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={epsReadyCount === 0}
                              loading={exporting === "zip"}
                              onClick={() => void handleExportOrderZip()}
                              leftIcon={<Archive className="h-3.5 w-3.5" />}
                            >
                              .ZIP ({epsReadyCount}/{orderItems.length})
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="primary"
                              loading={exporting === "prod-pdf"}
                              onClick={() => void handleExportProduction("pdf")}
                              leftIcon={<FileText className="h-3.5 w-3.5" />}
                            >
                              Mesas (.PDF)
                            </Button>

                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              loading={exporting === "prod-eps"}
                              onClick={() => void handleExportProduction("eps")}
                              leftIcon={<Scroll className="h-3.5 w-3.5 text-accent" />}
                            >
                              Carriles (.EPS)
                            </Button>

                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={epsReadyCount === 0}
                              loading={exporting === "zip"}
                              onClick={() => void handleExportOrderZip()}
                              leftIcon={<Archive className="h-3.5 w-3.5" />}
                            >
                              .ZIP ({epsReadyCount}/{orderItems.length})
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Single-Design Order Package (.ZIP) */}
                  {sourceMode === "order" && activeOrder && orderItems.length < 2 && epsReadyCount >= 1 && (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-preflight-ok-border/70 bg-preflight-ok-bg/75 p-2.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-preflight-ok-ink">
                        <Archive className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>Paquete .ZIP listo</span>
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        loading={exporting === "zip"}
                        onClick={() => void handleExportOrderZip()}
                        leftIcon={<Archive className="h-3.5 w-3.5" />}
                      >
                        Descargar .ZIP
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB: FORMA (Tipo de troquel + Margen Blanco) */}
            {activeToolTab === "forma" && (
              <div className="space-y-3">
                {/* 1. Die-Cut Geometry + White Margin (Sticker Offset 0–10 mm) */}
                <StickerCard padding="sm" className="space-y-3.5">
                  <div className="flex items-center justify-between gap-2 border-b border-dashed border-line-subtle pb-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-accent"
                      >
                        <Scissors className="h-3.5 w-3.5" />
                      </span>
                      <h2 className="font-display text-xs font-extrabold uppercase tracking-wider text-ink-primary">
                        Forma y Margen Blanco
                      </h2>
                    </div>
              {sourceMode === "order" && activeShape && (
                <span className="rounded-xs border border-line-diecut/50 bg-accent-soft/50 px-1.5 py-0.5 font-mono text-[9px] font-bold text-accent">
                  Ítem: {activeShape}
                </span>
              )}
            </div>

            {/* 4 Core Order Shapes + Custom Polygon */}
            <div className="grid grid-cols-2 gap-1.5 text-[11px] font-bold">
              {(
                [
                  { id: "en_su_forma", label: "En su forma", icon: Sparkles },
                  { id: "circular", label: "Circular", icon: Circle },
                  { id: "rectangular", label: "Rectangular", icon: RectangleHorizontal },
                  { id: "cuadrado", label: "Cuadrado", icon: Square },
                ] as {
                  id: DieCutUiShapePreset;
                  label: string;
                  icon: React.ComponentType<{ className?: string }>;
                }[]
              ).map((m) => {
                const Icon = m.icon;
                const active = shapePreset === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleSelectShapePreset(m.id)}
                    className={`flex items-center gap-2 rounded-md border px-2.5 py-2 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      active
                        ? "border-accent bg-accent text-accent-ink shadow-xs"
                        : "border-line-subtle bg-surface-card text-ink-primary hover:border-line-diecut hover:bg-surface-elevated"
                    }`}
                  >
                    <Icon
                      className={`h-3.5 w-3.5 shrink-0 ${
                        active ? "text-accent-ink" : "text-accent"
                      }`}
                      aria-hidden="true"
                    />
                    <span className="truncate">{m.label}</span>
                  </button>
                );
              })}

              <button
                type="button"
                aria-pressed={shapePreset === "poligono_regular"}
                onClick={() => handleSelectShapePreset("poligono_regular")}
                className={`col-span-2 flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  shapePreset === "poligono_regular"
                    ? "border-accent bg-accent text-accent-ink shadow-xs"
                    : "border-line-subtle bg-surface-elevated/60 text-ink-secondary hover:border-line-diecut hover:text-ink-primary"
                }`}
              >
                <Hexagon
                  className={`h-3.5 w-3.5 ${
                    shapePreset === "poligono_regular" ? "text-accent-ink" : "text-accent"
                  }`}
                  aria-hidden="true"
                />
                <span>Polígono Regular (3–12 lados)</span>
              </button>
            </div>

            {/* Polygon Options */}
            {(shapePreset === "poligono_regular" || shapePreset === "cuadrado") && (
              <div className="space-y-2.5 rounded-lg border border-dashed border-line-diecut/65 bg-accent-soft/35 p-2.5">
                {shapePreset === "poligono_regular" && (
                  <Select
                    label="Lados del polígono"
                    value={String(params.polygon_sides)}
                    onChange={(e) =>
                      updateActiveSession((prev) => ({
                        ...prev,
                        params: { ...prev.params, polygon_sides: Number(e.target.value) },
                      }))
                    }
                  >
                    {POLYGON_PRESETS.map((p) => (
                      <option key={p.sides} value={p.sides}>
                        {p.label}
                      </option>
                    ))}
                    <option value="7">Heptágono (7)</option>
                    <option value="9">Eneágono (9)</option>
                    <option value="12">Dodecágono (12)</option>
                  </Select>
                )}

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-ink-secondary">Rotación</span>
                    <span className="rounded-xs border border-line-subtle bg-surface-card px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-ink-primary">
                      {params.polygon_rotation_deg}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={5}
                    value={params.polygon_rotation_deg}
                    onChange={(e) =>
                      updateActiveSession((prev) => ({
                        ...prev,
                        params: {
                          ...prev.params,
                          polygon_rotation_deg: Number(e.target.value),
                        },
                      }))
                    }
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-elevated accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>
            )}

            {/* Real Physical Dimensions (cm) & Discrete Scale Fit Mode Selector */}
            <div className="space-y-2.5 rounded-lg border border-line-subtle bg-surface-elevated/55 p-2.5">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex items-center gap-1.5 font-extrabold text-ink-primary">
                  <Ruler className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                  <span>Medidas Reales (.EPS)</span>
                </span>
                <span className="rounded-xs border border-line-diecut/60 bg-surface-card px-1.5 py-0.5 font-mono text-[10px] font-extrabold tabular-nums text-accent">
                  {sourceMode === "order" && activeSizeDisplay
                    ? `Pedido ${activeSizeDisplay}`
                    : `${formatCmLabel(effectiveTargetWidthCm)}×${formatCmLabel(
                        effectiveTargetHeightCm
                      )} cm`}
                </span>
              </div>

              {/* Editable physical width/height (always shown for standalone upload, or editable override for order) */}
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-[10px] font-semibold text-ink-secondary">
                  <span className="block">Ancho objetivo (cm)</span>
                  <input
                    type="number"
                    min={0.5}
                    max={500}
                    step={0.1}
                    aria-label="Ancho físico objetivo en centímetros"
                    value={effectiveTargetWidthCm ?? ""}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      updateActiveSession((prev) => ({
                        ...prev,
                        params: {
                          ...prev.params,
                          target_width_cm: Number.isFinite(val) && val > 0 ? val : null,
                        },
                      }));
                    }}
                    className="h-8 w-full rounded-md border border-line-subtle bg-surface-card px-2 font-mono text-xs font-bold tabular-nums text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>

                <label className="space-y-1 text-[10px] font-semibold text-ink-secondary">
                  <span className="block">Alto objetivo (cm)</span>
                  <input
                    type="number"
                    min={0.5}
                    max={500}
                    step={0.1}
                    aria-label="Alto físico objetivo en centímetros"
                    value={effectiveTargetHeightCm ?? ""}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      updateActiveSession((prev) => ({
                        ...prev,
                        params: {
                          ...prev.params,
                          target_height_cm: Number.isFinite(val) && val > 0 ? val : null,
                        },
                      }));
                    }}
                    className="h-8 w-full rounded-md border border-line-subtle bg-surface-card px-2 font-mono text-xs font-bold tabular-nums text-ink-primary focus:border-line-diecut focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              </div>

              {/* Discrete Scale Fit Selector: Proporcional (recomendado) vs Medida exacta (sin bordes extra) */}
              <div className="space-y-1">
                <span className="block text-[10px] font-semibold text-ink-secondary">
                  Ajuste de escala al tamaño objetivo
                </span>
                <div
                  role="group"
                  aria-label="Modo de ajuste de escala"
                  className="grid grid-cols-1 gap-1 text-[10px] font-bold"
                >
                  {(
                    [
                      {
                        id: "contain_proportional",
                        label: "Proporcional (recomendado)",
                        hint: "Mantiene la proporción original sin deformar el arte",
                      },
                      {
                        id: "exact_stretch",
                        label: "Medida exacta (sin bordes extra)",
                        hint: "Ajusta el troquel exactamente al ancho y alto indicados",
                      },
                    ] as { id: DieCutFitMode; label: string; hint: string }[]
                  ).map((opt) => {
                    const active = (params.fit_mode ?? "contain_proportional") === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={active}
                        title={opt.hint}
                        onClick={() =>
                          updateActiveSession((prev) => ({
                            ...prev,
                            params: { ...prev.params, fit_mode: opt.id },
                          }))
                        }
                        className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-left transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          active
                            ? "border-accent bg-accent text-accent-ink shadow-xs"
                            : "border-line-subtle bg-surface-card text-ink-secondary hover:border-line-diecut hover:text-ink-primary"
                        }`}
                      >
                        <span>{opt.label}</span>
                        {active && (
                          <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* BLOCK A: White Margin (Sticker Offset 0–10 mm) */}
            <div
              className="space-y-2 rounded-lg border border-dashed border-line-diecut bg-accent-soft/45 p-2.5"
              title="Agrega un borde blanco real impreso alrededor del arte antes de trazar la línea de corte."
            >
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-extrabold text-ink-primary">Margen Blanco</span>
                <span className="rounded-xs border border-line-diecut/60 bg-surface-card px-1.5 py-0.5 font-mono text-[10px] font-extrabold tabular-nums text-accent">
                  {params.white_border_mm === 0
                    ? "0.0 mm"
                    : `+${params.white_border_mm.toFixed(1)} mm`}
                </span>
              </div>
              <input
                type="range"
                aria-label="Margen blanco de sticker en milímetros (white_border_mm)"
                min={0}
                max={10}
                step={0.5}
                value={params.white_border_mm}
                onChange={(e) =>
                  updateActiveSession((prev) => ({
                    ...prev,
                    params: { ...prev.params, white_border_mm: Number(e.target.value) },
                  }))
                }
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-card accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="grid grid-cols-4 gap-1 font-mono text-[10px] font-bold">
                {WHITE_BORDER_QUICK_PRESETS.map((mm) => {
                  const active = Math.abs(params.white_border_mm - mm) < 0.01;
                  return (
                    <button
                      key={mm}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        updateActiveSession((prev) => ({
                          ...prev,
                          params: { ...prev.params, white_border_mm: mm },
                        }))
                      }
                      className={`rounded-sm border py-1 tabular-nums transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        active
                          ? "border-accent bg-accent text-accent-ink"
                          : "border-line-subtle bg-surface-card text-ink-secondary hover:border-line-diecut hover:text-ink-primary"
                      }`}
                    >
                      {mm === 0 ? "0 mm" : `+${mm} mm`}
                    </button>
                  );
                })}
              </div>
            </div>
                </StickerCard>
              </div>
            )}

            {/* TAB: TRAZADO (Corte Exterior/Interior, Redondeo, Fidelidad, Bordes, Capas .EPS y Nodos) */}
            {activeToolTab === "trazado" && (
              <div className="space-y-3">
                <StickerCard padding="sm" className="space-y-3.5">
            {/* BLOCK B: Fine Cut Line Adjustment (Interior / Exterior) */}
            <div
              className="space-y-2 rounded-lg border border-line-subtle bg-surface-elevated/45 p-2.5"
              title="Desplaza únicamente la cuchilla CutContour hacia afuera o hacia adentro."
            >
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-extrabold text-ink-primary">Ajuste de Corte</span>
                <span className="font-mono text-[10px] font-bold uppercase text-accent">
                  {params.cut_direction === "inside" ? "Interior" : "Exterior"}
                </span>
              </div>

              <div
                role="group"
                aria-label="Dirección del corte de troquelado"
                className="grid grid-cols-2 gap-1.5 text-[11px] font-bold"
              >
                {(
                  [
                    { id: "outside", label: "Por fuera", icon: Maximize2 },
                    { id: "inside", label: "Por dentro", icon: Minimize2 },
                  ] as {
                    id: DieCutDirection;
                    label: string;
                    icon: React.ComponentType<{ className?: string }>;
                  }[]
                ).map((dir) => {
                  const Icon = dir.icon;
                  const active = params.cut_direction === dir.id;
                  return (
                    <button
                      key={dir.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        updateActiveSession((prev) => ({
                          ...prev,
                          params: {
                            ...prev.params,
                            cut_direction: dir.id,
                            bleed_mm:
                              dir.id === "inside" && prev.params.bleed_mm > 5
                                ? 2.0
                                : prev.params.bleed_mm,
                          },
                        }))
                      }
                      className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        active
                          ? "border-accent bg-accent text-accent-ink shadow-xs"
                          : "border-line-subtle bg-surface-card text-ink-primary hover:border-line-diecut hover:bg-surface-elevated"
                      }`}
                    >
                      <Icon
                        className={`h-3.5 w-3.5 ${active ? "text-accent-ink" : "text-accent"}`}
                        aria-hidden="true"
                      />
                      <span>{dir.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Fine Cut Offset Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-ink-secondary">
                    {params.cut_direction === "inside"
                      ? "Sangrado interior (recorte)"
                      : "Holgura exterior de cuchilla"}
                  </span>
                  <div className="flex items-center gap-1">
                    {params.bleed_mm > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          updateActiveSession((prev) => ({
                            ...prev,
                            params: { ...prev.params, bleed_mm: 0 },
                          }))
                        }
                        className="rounded-xs border border-line-subtle bg-surface-card px-1.5 py-0.5 font-mono text-[9px] font-bold text-ink-muted hover:border-line-diecut hover:text-accent"
                        title="Dejar la línea de corte exactamente al ras (0.0 mm)"
                      >
                        Al ras (0 mm)
                      </button>
                    )}
                    <span className="rounded-xs border border-line-subtle bg-surface-card px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-ink-primary">
                      {params.bleed_mm === 0
                        ? "0.0 mm"
                        : `${params.cut_direction === "inside" ? "-" : "+"}${params.bleed_mm.toFixed(1)} mm`}
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={12}
                  step={0.5}
                  value={params.bleed_mm}
                  onChange={(e) =>
                    updateActiveSession((prev) => ({
                      ...prev,
                      params: { ...prev.params, bleed_mm: Number(e.target.value) },
                    }))
                  }
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-card accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              {/* Explicit Warning/Breakdown when BOTH White Margin and Exterior Cut Offset are > 0 */}
              {params.white_border_mm > 0 &&
                params.cut_direction === "outside" &&
                params.bleed_mm > 0 && (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-preflight-warn-border/75 bg-preflight-warn-bg/80 px-2.5 py-1.5 text-[10px] text-preflight-warn-ink">
                    <span className="font-mono font-semibold">
                      Suma actual: +{params.white_border_mm.toFixed(1)} mm blanco +{" "}
                      {params.bleed_mm.toFixed(1)} mm corte = +
                      {(params.white_border_mm + params.bleed_mm).toFixed(1)} mm
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateActiveSession((prev) => ({
                          ...prev,
                          params: { ...prev.params, bleed_mm: 0 },
                        }))
                      }
                      className="shrink-0 rounded-xs border border-preflight-warn-border bg-surface-card px-1.5 py-0.5 font-mono text-[9px] font-extrabold text-preflight-warn-ink hover:bg-surface-elevated"
                    >
                      Cortar al borde blanco
                    </button>
                  </div>
                )}
            </div>

            {/* Vertex Rounding (Default 65%) */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-ink-secondary">Redondeo de vértices</span>
                <span className="rounded-xs border border-line-subtle bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-ink-primary">
                  {Math.round(params.corner_roundness * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={1.0}
                step={0.05}
                value={params.corner_roundness}
                onChange={(e) =>
                  updateActiveSession((prev) => ({
                    ...prev,
                    params: { ...prev.params, corner_roundness: Number(e.target.value) },
                  }))
                }
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-elevated accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            {/* Universal "Simplificar trazado" Control (Available for ANY job & saved in Ctrl+Z history) */}
            <div className="space-y-2 rounded-lg border border-dashed border-line-diecut/75 bg-surface-elevated/60 p-2.5">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex items-center gap-1.5 font-extrabold text-ink-primary">
                  <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                  <span>Simplificar trazado</span>
                </span>
                <span className="rounded-xs border border-line-diecut/60 bg-surface-card px-1.5 py-0.5 font-mono text-[10px] font-extrabold tabular-nums text-accent">
                  {anchors.length} nodos → {projectedSimplifiedNodes} nodos
                </span>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-semibold text-ink-secondary">
                    Intensidad de simplificación
                  </span>
                  <span className="font-mono font-bold tabular-nums text-ink-primary">
                    {simplifyIntensity}%
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Intensidad de simplificación de trazado (0 a 100%)"
                  min={0}
                  max={100}
                  step={5}
                  value={simplifyIntensity}
                  onChange={(e) => setSimplifyIntensity(Number(e.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-card accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="font-mono text-[10px] text-ink-muted">
                  Ramer-Douglas-Peucker · Ctrl+Z
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={anchors.length <= 3 || simplifyIntensity <= 0 || cutLayerLocked}
                  onClick={handleApplySimplifyPath}
                  leftIcon={<Sparkles className="h-3.5 w-3.5 text-accent" />}
                >
                  Aplicar ({anchors.length} nodos → {projectedSimplifiedNodes} nodos)
                </Button>
              </div>
            </div>

            {/* Silhouette Precision Options + Auto-Removed Solid Background Notice */}
            {shapePreset === "en_su_forma" && (
              <div className="space-y-2 border-t border-dashed border-line-subtle pt-2.5">
                {(result?.background_removed || activeSession.includeOriginalBackground) && (
                  <div
                    className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-line-diecut/75 bg-state-info-bg/75 p-2 text-[11px] text-state-info-ink"
                    title={
                      activeSession.includeOriginalBackground
                        ? "El corte bordea el cuadro completo de la imagen sin recortar el fondo."
                        : "Se detectó un fondo opaco y se aisló la figura principal."
                    }
                  >
                    <span className="truncate font-bold">
                      {activeSession.includeOriginalBackground
                        ? "Fondo incluido"
                        : "Fondo removido"}
                    </span>
                    <button
                      type="button"
                      onClick={handleToggleIncludeOriginalBackground}
                      className="shrink-0 rounded-md border border-line-diecut/70 bg-surface-card px-2 py-1 font-mono text-[10px] font-extrabold text-accent shadow-xs transition-colors duration-fast hover:bg-accent hover:text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {activeSession.includeOriginalBackground ? "Quitar fondo" : "Incluir fondo"}
                    </button>
                  </div>
                )}

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-ink-secondary">Fidelidad de silueta</span>
                    <span className="rounded-xs border border-line-subtle bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink-primary">
                      {params.smoothing_epsilon <= 0.0025
                        ? "Detallada"
                        : params.smoothing_epsilon <= 0.006
                        ? "Equilibrada"
                        : "Suave"}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.0015}
                    max={0.015}
                    step={0.0005}
                    value={params.smoothing_epsilon}
                    onChange={(e) =>
                      updateActiveSession((prev) => ({
                        ...prev,
                        params: { ...prev.params, smoothing_epsilon: Number(e.target.value) },
                      }))
                    }
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-elevated accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-line-subtle bg-surface-elevated/55 px-2.5 py-1.5 text-[11px] text-ink-secondary hover:border-line-strong hover:text-ink-primary">
                  <span>Unir islas en un solo corte</span>
                  <input
                    type="checkbox"
                    checked={params.merge_islands}
                    onChange={(e) =>
                      updateActiveSession((prev) => ({
                        ...prev,
                        params: { ...prev.params, merge_islands: e.target.checked },
                      }))
                    }
                    className="h-3.5 w-3.5 shrink-0 rounded-xs border-line-strong accent-accent focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>

                <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-line-subtle bg-surface-elevated/55 px-2.5 py-1.5 text-[11px] text-ink-secondary hover:border-line-strong hover:text-ink-primary">
                  <span>Forzar remoción de fondo</span>
                  <input
                    type="checkbox"
                    checked={params.remove_background}
                    onChange={(e) =>
                      updateActiveSession((prev) => ({
                        ...prev,
                        includeOriginalBackground: e.target.checked
                          ? false
                          : prev.includeOriginalBackground,
                        params: { ...prev.params, remove_background: e.target.checked },
                      }))
                    }
                    className="h-3.5 w-3.5 shrink-0 rounded-xs border-line-strong accent-accent focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
              </div>
            )}
          </StickerCard>

          {/* 2. Base-Color Border Panel */}
          <StickerCard padding="sm" className="space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-dashed border-line-subtle pb-2">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-accent"
                >
                  <Palette className="h-3.5 w-3.5" />
                </span>
                <h2 className="font-display text-xs font-extrabold uppercase tracking-wider text-ink-primary">
                  Base de Color (Capa 1)
                </h2>
              </div>
              {activeBorderColor && (
                <span className="inline-flex items-center gap-1 rounded-full border border-line-subtle bg-surface-elevated px-1.5 py-0.5 font-mono text-[9px] font-bold text-ink-primary">
                  <span
                    aria-hidden="true"
                    style={{ backgroundColor: activeBorderColor }}
                    className="h-2.5 w-2.5 rounded-full border border-line-strong"
                  />
                  {activeBorderColor}
                </span>
              )}
            </div>

            <div
              role="group"
              aria-label="Tipo de base de color"
              className="grid grid-cols-2 gap-1.5 text-[11px] font-bold"
            >
              {(
                [
                  { id: "none", label: "Sin base", swatch: null },
                  {
                    id: "base_color",
                    label: "Color base",
                    swatch: result?.detected_base_color ?? null,
                  },
                  { id: "white", label: "Blanco vinilo", swatch: "#FFFFFF" },
                  { id: "custom", label: "Personalizado", swatch: customBorderColor },
                ] as { id: DieCutBorderMode; label: string; swatch: string | null }[]
              ).map((opt) => {
                const active = borderMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      updateActiveSession((prev) => {
                        const wasNone = prev.borderMode === "none";
                        return {
                          ...prev,
                          borderMode: opt.id,
                          borderCutPosition:
                            wasNone && opt.id !== "none" ? "inside_base" : prev.borderCutPosition,
                          customBorderColor:
                            opt.id === "custom" &&
                            prev.result?.detected_base_color &&
                            prev.customBorderColor === "#FFFFFF"
                              ? prev.result.detected_base_color
                              : prev.customBorderColor,
                        };
                      })
                    }
                    className={`flex items-center justify-between gap-1.5 rounded-md border px-2 py-1.5 text-left transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      active
                        ? "border-accent bg-accent text-accent-ink shadow-xs"
                        : "border-line-subtle bg-surface-card text-ink-primary hover:border-line-diecut hover:bg-surface-elevated"
                    }`}
                  >
                    <span className="truncate">{opt.label}</span>
                    {opt.swatch ? (
                      <span
                        aria-hidden="true"
                        style={{ backgroundColor: opt.swatch }}
                        className="h-3.5 w-3.5 shrink-0 rounded-full border border-line-strong"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="bg-transparency-grid h-3.5 w-3.5 shrink-0 rounded-full border border-line-strong"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {result?.palette_colors && result.palette_colors.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-dashed border-line-subtle bg-surface-elevated/50 px-2.5 py-2">
                <span className="text-[10px] font-semibold text-ink-muted">Paleta:</span>
                {result.palette_colors.map((hex) => {
                  const isSelectedSwatch =
                    activeBorderColor?.toUpperCase() === hex.toUpperCase();
                  return (
                    <button
                      key={hex}
                      type="button"
                      title={`Usar color ${hex}`}
                      onClick={() =>
                        updateActiveSession((prev) => ({
                          ...prev,
                          borderMode: hex === prev.result?.detected_base_color ? "base_color" : "custom",
                          customBorderColor: hex,
                        }))
                      }
                      style={{ backgroundColor: hex }}
                      className={`h-5 w-5 rounded-full border-2 shadow-xs transition-transform duration-fast hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        isSelectedSwatch
                          ? "scale-110 border-accent ring-2 ring-accent/40"
                          : "border-surface-card"
                      }`}
                      aria-label={`Aplicar base ${hex}`}
                    />
                  );
                })}
              </div>
            )}

            {borderMode === "custom" && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-line-subtle bg-surface-elevated/60 px-2.5 py-1.5 text-[11px]">
                <label htmlFor="diecut-custom-border-color" className="font-semibold text-ink-secondary">
                  Color manual
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="diecut-custom-border-color"
                    type="color"
                    value={customBorderColor}
                    onChange={(e) =>
                      updateActiveSession((prev) => ({
                        ...prev,
                        customBorderColor: e.target.value.toUpperCase(),
                      }))
                    }
                    className="h-6 w-8 cursor-pointer rounded-xs border border-line-strong bg-surface-card p-0.5"
                  />
                  <span className="font-mono text-[10px] font-bold text-ink-primary">
                    {customBorderColor}
                  </span>
                </div>
              </div>
            )}

            {borderMode !== "none" && (
              <div className="space-y-2 rounded-md border border-dashed border-line-diecut/70 bg-accent-soft/35 p-2.5 text-[11px]">
                <div className="grid grid-cols-2 gap-1 font-bold">
                  <button
                    type="button"
                    aria-pressed={borderCutPosition === "inside_base"}
                    onClick={() =>
                      updateActiveSession((prev) => ({ ...prev, borderCutPosition: "inside_base" }))
                    }
                    className={`rounded-sm border px-2 py-1.5 transition-colors duration-fast ${
                      borderCutPosition === "inside_base"
                        ? "border-accent bg-accent text-accent-ink"
                        : "border-line-subtle bg-surface-card text-ink-secondary hover:text-ink-primary"
                    }`}
                  >
                    Dentro de base
                  </button>
                  <button
                    type="button"
                    aria-pressed={borderCutPosition === "outside_base"}
                    onClick={() =>
                      updateActiveSession((prev) => ({
                        ...prev,
                        borderCutPosition: "outside_base",
                      }))
                    }
                    className={`rounded-sm border px-2 py-1.5 transition-colors duration-fast ${
                      borderCutPosition === "outside_base"
                        ? "border-accent bg-accent text-accent-ink"
                        : "border-line-subtle bg-surface-card text-ink-secondary hover:text-ink-primary"
                    }`}
                  >
                    Fuera de base
                  </button>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-semibold text-ink-secondary">Offset de base</span>
                    <span className="font-mono font-bold tabular-nums text-ink-primary">
                      {borderOffsetMm.toFixed(1)} mm
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={6.0}
                    step={0.5}
                    value={borderOffsetMm}
                    onChange={(e) =>
                      updateActiveSession((prev) => ({
                        ...prev,
                        borderOffsetMm: Number(e.target.value),
                      }))
                    }
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-card accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                {params.cut_direction === "inside" && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-semibold text-ink-secondary">Borde interior</span>
                      <span className="font-mono font-bold tabular-nums text-ink-primary">
                        {borderWidthMm.toFixed(1)} mm
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={8}
                      step={0.5}
                      value={borderWidthMm}
                      onChange={(e) =>
                        updateActiveSession((prev) => ({
                          ...prev,
                          borderWidthMm: Number(e.target.value),
                        }))
                      }
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-card accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                )}
              </div>
            )}
          </StickerCard>

          {/* 3. Illustrator-Style 2-Layer Panel */}
          <StickerCard dieCut padding="sm" className="space-y-2.5">
            <div className="flex items-center gap-2 border-b border-dashed border-line-subtle pb-2">
              <Layers className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              <h2 className="font-display text-xs font-extrabold uppercase tracking-wider text-ink-primary">
                Capas .EPS
              </h2>
            </div>

            {/* Capa 2: CutContour */}
            <div className="rounded-md border border-dashed border-line-diecut/70 bg-accent-soft/35 p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`h-3 w-3 shrink-0 rounded-full ${
                      cutContourTone === "cyan" ? "bg-cutcontour-cyan" : "bg-cutcontour-magenta"
                    }`}
                  />
                  <div>
                    <p className="text-[11px] font-bold text-ink-primary">Capa 2 · CutContour</p>
                    <p className="font-mono text-[10px] tabular-nums text-ink-muted">
                      {cutStrokeWidthPt.toFixed(2)} pt · {anchors.length} nodos
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    aria-pressed={cutLayerLocked}
                    onClick={() => setCutLayerLocked((v) => !v)}
                    title={cutLayerLocked ? "Desbloquear capa de corte" : "Bloquear capa de corte"}
                    className="rounded-sm p-1 text-ink-secondary hover:bg-surface-card hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {cutLayerLocked ? (
                      <Lock className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    ) : (
                      <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-pressed={showCutLayer}
                    onClick={() => setShowCutLayer((v) => !v)}
                    title="Mostrar/ocultar Capa 2"
                    className="rounded-sm p-1 text-ink-secondary hover:bg-surface-card hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showCutLayer ? (
                      <Eye className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <div className="mt-2 space-y-1.5 border-t border-dashed border-line-subtle pt-2">
                <div className="grid grid-cols-4 gap-1 font-mono text-[10px] font-bold">
                  {[0.25, 0.5, 1.0, 1.5].map((ptVal) => {
                    const isPreset = Math.abs(cutStrokeWidthPt - ptVal) < 0.01;
                    return (
                      <button
                        key={ptVal}
                        type="button"
                        aria-pressed={isPreset}
                        onClick={() =>
                          updateActiveSession((prev) => ({ ...prev, cutStrokeWidthPt: ptVal }))
                        }
                        className={`rounded-sm border py-1 tabular-nums transition-colors duration-fast ${
                          isPreset
                            ? "border-accent bg-accent text-accent-ink"
                            : "border-line-subtle bg-surface-card text-ink-secondary hover:border-line-diecut hover:text-ink-primary"
                        }`}
                      >
                        {ptVal} pt
                      </button>
                    );
                  })}
                </div>

                <label className="flex cursor-pointer items-center justify-between pt-1 text-[11px] text-ink-secondary">
                  <span>Previsualizar punteado</span>
                  <input
                    type="checkbox"
                    checked={dashedPreview}
                    onChange={(e) => setDashedPreview(e.target.checked)}
                    className="h-3.5 w-3.5 rounded-xs border-line-strong accent-accent focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
              </div>
            </div>

            {/* Capa 1: Diseño */}
            <div className="rounded-md border border-line-subtle bg-surface-elevated/60 p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-xs bg-accent" />
                  <div>
                    <p className="text-[11px] font-bold text-ink-primary">Capa 1 · Arte CMYK</p>
                    <p className="font-mono text-[10px] tabular-nums text-ink-muted">
                      {result ? `${result.image_width}×${result.image_height} px` : "PNG"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-pressed={showDesignLayer}
                  onClick={() => setShowDesignLayer((v) => !v)}
                  title="Mostrar/ocultar Capa 1"
                  className="rounded-sm p-1 text-ink-secondary hover:bg-surface-card hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showDesignLayer ? (
                    <Eye className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2 border-t border-dashed border-line-subtle pt-1.5 text-[10px] text-ink-muted">
                <span>Opacidad</span>
                <input
                  type="range"
                  min={20}
                  max={100}
                  value={designOpacity}
                  onChange={(e) => setDesignOpacity(Number(e.target.value))}
                  className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-surface-card accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span className="font-mono font-bold tabular-nums text-ink-primary">
                  {designOpacity}%
                </span>
              </div>
            </div>
          </StickerCard>

          {/* 4. Selected Bezier Anchor Point Inspector */}
          {selectedAnchor && selectedIndex !== null && (
            <StickerCard
              tone="accent"
              padding="sm"
              className="space-y-2 text-xs"
              title="Arrastra sus 2 manejadores con clic izquierdo (Alt rompe tangente) · Clic derecho alterna curva/esquina."
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-ink-primary">Nodo #{selectedIndex + 1}</span>
                <span className="rounded-xs border border-line-diecut/40 bg-surface-card px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums text-ink-primary">
                  X:{selectedAnchor.x.toFixed(0)} · Y:{selectedAnchor.y.toFixed(0)}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={handleToggleSelectedSmooth}
                >
                  {selectedAnchor.smooth ? "Curva suave" : "Esquina aguda"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={anchors.length <= 3}
                  onClick={handleDeleteSelectedAnchor}
                  leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                >
                  Eliminar
                </Button>
              </div>
            </StickerCard>
          )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </motion.div>
  );
};
