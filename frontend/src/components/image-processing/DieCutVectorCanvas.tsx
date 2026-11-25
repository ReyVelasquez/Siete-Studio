import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Eye,
  EyeOff,
  Hand,
  Loader2,
  Lock,
  MousePointer2,
  Plus,
  Redo2,
  Scissors,
  Sparkles,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type {
  BezierAnchor,
  DieCutBorderCutPosition,
  DieCutCutContourTone,
  DieCutDirection,
  DieCutFitMode,
} from "@/types/order";
import {
  ensureVisibleHandlesForAnchor,
  toggleAnchorSmoothCorner,
} from "@/utils/bezierSimplify";

export type VectorTool = "select" | "add_point" | "delete_point" | "pan";

interface DieCutVectorCanvasProps {
  artworkUrl: string | null;
  imageWidth: number;
  imageHeight: number;
  dpi?: number;
  /** Physical canvas width in cm for real-scale top ruler. Defaults to (imageWidth / dpi) * 2.54. */
  physicalWidthCm?: number;
  /** Physical canvas height in cm for real-scale left ruler. Defaults to (imageHeight / dpi) * 2.54. */
  physicalHeightCm?: number;
  /** Real width of the CutContour vector path in cm. */
  cutWidthCm?: number;
  /** Real height of the CutContour vector path in cm. */
  cutHeightCm?: number;
  /** Target requested width in cm (from order_item or manual input). */
  targetWidthCm?: number | null;
  /** Target requested height in cm (from order_item or manual input). */
  targetHeightCm?: number | null;
  /** Scale adjustment mode ("contain_proportional" | "exact_stretch"). */
  fitMode?: DieCutFitMode;
  /** Requested target sticker size display (e.g. "Ø 5 cm" or "5x7 cm") shown in darkroom HUD. */
  targetSizeDisplay?: string | null;
  /** Active white sticker margin offset in mm (shown in telemetry pill when > 0). */
  whiteBorderMm?: number;
  /** Fine cut line offset in mm (distinct from whiteBorderMm). */
  bleedMm?: number;
  cutDirection?: DieCutDirection;
  /** High-contrast CutContour stroke color token ("magenta" | "cyan"). */
  cutContourTone?: DieCutCutContourTone;
  onCutContourToneChange?: (tone: DieCutCutContourTone) => void;
  borderColor?: string | null;
  borderWidthMm?: number;
  borderCutPosition?: DieCutBorderCutPosition;
  borderOffsetMm?: number;
  cutStrokeWidthPt?: number;
  anchors: BezierAnchor[];
  selectedIndex: number | null;
  onSelectIndex: (index: number | null) => void;
  onChangeAnchors: (next: BezierAnchor[], pushHistory?: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  showDesignLayer: boolean;
  designOpacity: number;
  showCutLayer: boolean;
  cutLayerLocked: boolean;
  dashedPreview: boolean;
  /** Controls visibility of white anchor points and Bezier directional handles (shortcut P). */
  showPoints?: boolean;
  onToggleShowPoints?: () => void;
  loading: boolean;
  onSmoothAllVertices: () => void;
}

type DragTarget =
  | { kind: "anchor"; index: number }
  | { kind: "in"; index: number }
  | { kind: "out"; index: number };

const MIN_ZOOM = 50;
const MAX_ZOOM = 400;
const STAGE_PADDING = 20;
const RULER_THICKNESS = 22;

export function buildSvgPathD(anchors: BezierAnchor[]): string {
  if (anchors.length < 3) return "";
  const first = anchors[0];
  const parts: string[] = [`M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`];
  const n = anchors.length;
  for (let i = 0; i < n; i += 1) {
    const curr = anchors[i];
    const nxt = anchors[(i + 1) % n];
    parts.push(
      `C ${curr.out_x.toFixed(2)} ${curr.out_y.toFixed(2)}, ${nxt.in_x.toFixed(2)} ${nxt.in_y.toFixed(2)}, ${nxt.x.toFixed(2)} ${nxt.y.toFixed(2)}`
    );
  }
  parts.push("Z");
  return parts.join(" ");
}

/** Evaluate cubic Bezier point at parameter t in [0, 1]. */
function evalCubic(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number
): { x: number; y: number } {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
  };
}

/** Exact De Casteljau subdivision at t so inserting a point preserves the exact rounded curve! */
function insertAnchorOnNearestSegment(
  anchors: BezierAnchor[],
  clickX: number,
  clickY: number
): { next: BezierAnchor[]; insertedIndex: number } {
  const n = anchors.length;
  let bestSeg = 0;
  let bestT = 0.5;
  let bestDistSq = Number.POSITIVE_INFINITY;

  for (let i = 0; i < n; i += 1) {
    const a = anchors[i];
    const b = anchors[(i + 1) % n];
    const p0 = { x: a.x, y: a.y };
    const p1 = { x: a.out_x, y: a.out_y };
    const p2 = { x: b.in_x, y: b.in_y };
    const p3 = { x: b.x, y: b.y };

    for (let s = 1; s < 24; s += 1) {
      const t = s / 24;
      const pt = evalCubic(p0, p1, p2, p3, t);
      const dx = pt.x - clickX;
      const dy = pt.y - clickY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestSeg = i;
        bestT = t;
      }
    }
  }

  const i = bestSeg;
  const j = (i + 1) % n;
  const a = anchors[i];
  const b = anchors[j];
  const t = bestT;
  const lerp = (u: number, v: number) => u + (v - u) * t;

  const p01x = lerp(a.x, a.out_x);
  const p01y = lerp(a.y, a.out_y);
  const p12x = lerp(a.out_x, b.in_x);
  const p12y = lerp(a.out_y, b.in_y);
  const p23x = lerp(b.in_x, b.x);
  const p23y = lerp(b.in_y, b.y);

  const p012x = lerp(p01x, p12x);
  const p012y = lerp(p01y, p12y);
  const p123x = lerp(p12x, p23x);
  const p123y = lerp(p12y, p23y);

  const midX = lerp(p012x, p123x);
  const midY = lerp(p012y, p123y);

  const updatedA: BezierAnchor = { ...a, out_x: round2(p01x), out_y: round2(p01y) };
  const updatedB: BezierAnchor = { ...b, in_x: round2(p23x), in_y: round2(p23y) };
  const newAnchor: BezierAnchor = {
    x: round2(midX),
    y: round2(midY),
    in_x: round2(p012x),
    in_y: round2(p012y),
    out_x: round2(p123x),
    out_y: round2(p123y),
    smooth: true,
  };

  const next = [...anchors];
  next[i] = updatedA;
  next[j] = updatedB;
  const insertedIndex = i + 1;
  next.splice(insertedIndex, 0, newAnchor);
  return { next, insertedIndex };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface BezierContourBBoxPx {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  widthPx: number;
  heightPx: number;
}

/** Measure exact cubic Bezier curve bounding box in image pixel space. */
export function measureBezierContourBBoxPx(
  anchors: BezierAnchor[],
  fallbackWidth: number,
  fallbackHeight: number
): BezierContourBBoxPx {
  if (anchors.length < 3) {
    return {
      minX: 0,
      maxX: fallbackWidth,
      minY: 0,
      maxY: fallbackHeight,
      widthPx: Math.max(1, fallbackWidth),
      heightPx: Math.max(1, fallbackHeight),
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const n = anchors.length;
  for (let i = 0; i < n; i += 1) {
    const a = anchors[i];
    const b = anchors[(i + 1) % n];
    const p0 = { x: a.x, y: a.y };
    const p1 = { x: a.out_x, y: a.out_y };
    const p2 = { x: b.in_x, y: b.in_y };
    const p3 = { x: b.x, y: b.y };

    for (let s = 0; s <= 12; s += 1) {
      const pt = evalCubic(p0, p1, p2, p3, s / 12);
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) {
    return {
      minX: 0,
      maxX: fallbackWidth,
      minY: 0,
      maxY: fallbackHeight,
      widthPx: Math.max(1, fallbackWidth),
      heightPx: Math.max(1, fallbackHeight),
    };
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    widthPx: Math.max(1, maxX - minX),
    heightPx: Math.max(1, maxY - minY),
  };
}

interface RulerTick {
  pos: number;
  kind: "major" | "half" | "minor";
  label?: string;
}

/** Generate calibrated centimeter/millimeter ticks aligned 1:1 with the artboard scale & scroll. */
function buildCentimeterTicks(
  viewportLength: number,
  originPx: number,
  pxPerCm: number
): RulerTick[] {
  if (viewportLength <= 0 || !Number.isFinite(pxPerCm) || pxPerCm <= 1) return [];

  const majorStepCm =
    pxPerCm >= 28 ? 1 : pxPerCm >= 14 ? 2 : pxPerCm >= 6 ? 5 : 10;
  const showHalf = pxPerCm >= 22 && majorStepCm === 1;
  const showMm = pxPerCm >= 54 && majorStepCm === 1;
  const subStepCm = showMm ? 0.1 : showHalf ? 0.5 : majorStepCm;

  const minCm = Math.floor(-originPx / pxPerCm) - 1;
  const maxCm = Math.ceil((viewportLength - originPx) / pxPerCm) + 1;
  const totalSteps = Math.min(800, Math.max(0, Math.ceil((maxCm - minCm) / subStepCm)));

  const ticks: RulerTick[] = [];
  const startStep = Math.floor(minCm / subStepCm);

  for (let s = 0; s <= totalSteps; s += 1) {
    const cm = round2((startStep + s) * subStepCm);
    const pos = originPx + cm * pxPerCm;
    if (pos < -8 || pos > viewportLength + 8) continue;

    const isMajor = Math.abs(cm % majorStepCm) < 0.001 || Math.abs(Math.abs(cm % majorStepCm) - majorStepCm) < 0.001;
    const isHalf = !isMajor && Math.abs((cm * 2) % 1) < 0.001;

    ticks.push({
      pos,
      kind: isMajor ? "major" : isHalf ? "half" : "minor",
      label: isMajor ? String(Math.round(cm)) : undefined,
    });
  }
  return ticks;
}

export const DieCutVectorCanvas: React.FC<DieCutVectorCanvasProps> = ({
  artworkUrl,
  imageWidth,
  imageHeight,
  dpi = 300,
  physicalWidthCm,
  physicalHeightCm,
  cutWidthCm,
  cutHeightCm,
  targetWidthCm = null,
  targetHeightCm = null,
  fitMode = "contain_proportional",
  targetSizeDisplay = null,
  whiteBorderMm = 0,
  bleedMm = 0,
  cutDirection = "outside",
  cutContourTone = "magenta",
  onCutContourToneChange,
  borderColor = null,
  borderWidthMm = 2.0,
  borderCutPosition = "inside_base",
  borderOffsetMm = 1.5,
  cutStrokeWidthPt = 0.5,
  anchors,
  selectedIndex,
  onSelectIndex,
  onChangeAnchors,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  showDesignLayer,
  designOpacity,
  showCutLayer,
  cutLayerLocked,
  dashedPreview,
  showPoints,
  onToggleShowPoints,
  loading,
  onSmoothAllVertices,
}) => {
  const insideClipId = useId();
  const outsideBaseMaskId = useId();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [viewportSize, setViewportSize] = useState({ width: 680, height: 480 });
  const [scrollPos, setScrollPos] = useState({ left: 0, top: 0 });
  const [cursorCm, setCursorCm] = useState<{ x: number; y: number } | null>(null);
  const [tool, setTool] = useState<VectorTool>("select");
  const [spacePressed, setSpacePressed] = useState(false);
  const [zoom, setZoom] = useState<number>(100);
  const [internalShowPoints, setInternalShowPoints] = useState<boolean>(true);
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const dragSnapshotPushedRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(
    null
  );

  const effectiveShowPoints = showPoints ?? internalShowPoints;
  const handleTogglePoints = useCallback(() => {
    if (onToggleShowPoints) {
      onToggleShowPoints();
    } else {
      setInternalShowPoints((prev) => !prev);
    }
  }, [onToggleShowPoints]);

  // Measure scroll viewport so 100% fits cleanly and rulers match screen pixels 1:1
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewportSize({ width: rect.width, height: rect.height });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-fit to 100% whenever a new artwork is loaded so it never clips top or bottom
  useEffect(() => {
    setZoom(100);
  }, [artworkUrl]);

  // Illustrator-style Ctrl/Cmd + wheel zoom directly on the vector viewport
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !artworkUrl) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 25 : -25;
      setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [artworkUrl]);

  // Compute exact CSS pixel dimensions for the SVG matching imageWidth x imageHeight aspect ratio
  const stageDims = useMemo(() => {
    const natW = Math.max(1, imageWidth);
    const natH = Math.max(1, imageHeight);
    const availW = Math.max(220, viewportSize.width - STAGE_PADDING * 2);
    const availH = Math.max(220, viewportSize.height - STAGE_PADDING * 2);
    const fitScale = Math.min(availW / natW, availH / natH);
    const factor = zoom / 100;
    return {
      width: Math.max(64, Math.round(natW * fitScale * factor)),
      height: Math.max(64, Math.round(natH * fitScale * factor)),
    };
  }, [imageWidth, imageHeight, viewportSize, zoom]);

  // Physical dimensions in cm synchronized with artboard pixels & order/target dimensions
  const effectivePhysicalW = useMemo(() => {
    if (physicalWidthCm && physicalWidthCm > 0) return physicalWidthCm;
    return Math.max(0.5, (imageWidth / Math.max(72, dpi)) * 2.54);
  }, [physicalWidthCm, imageWidth, dpi]);

  const effectivePhysicalH = useMemo(() => {
    if (physicalHeightCm && physicalHeightCm > 0) return physicalHeightCm;
    return Math.max(0.5, (imageHeight / Math.max(72, dpi)) * 2.54);
  }, [physicalHeightCm, imageHeight, dpi]);

  const cutBBoxPx = useMemo(
    () => measureBezierContourBBoxPx(anchors, imageWidth, imageHeight),
    [anchors, imageWidth, imageHeight]
  );

  const effectiveCutW = useMemo(() => {
    if (cutWidthCm && cutWidthCm > 0) return cutWidthCm;
    return round2((cutBBoxPx.widthPx / Math.max(1, imageWidth)) * effectivePhysicalW);
  }, [cutWidthCm, cutBBoxPx.widthPx, imageWidth, effectivePhysicalW]);

  const effectiveCutH = useMemo(() => {
    if (cutHeightCm && cutHeightCm > 0) return cutHeightCm;
    return round2((cutBBoxPx.heightPx / Math.max(1, imageHeight)) * effectivePhysicalH);
  }, [cutHeightCm, cutBBoxPx.heightPx, imageHeight, effectivePhysicalH]);

  const targetSummaryLabel = useMemo(() => {
    if (targetWidthCm && targetWidthCm > 0 && targetHeightCm && targetHeightCm > 0) {
      const fmt = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
      return `${fmt(targetWidthCm)}×${fmt(targetHeightCm)} cm`;
    }
    if (targetSizeDisplay) return targetSizeDisplay;
    return null;
  }, [targetWidthCm, targetHeightCm, targetSizeDisplay]);

  // Exact ruler pixel alignment relative to centered/scrolled SVG artboard
  const rulerMetrics = useMemo(() => {
    const stageContentX = Math.max(
      STAGE_PADDING,
      (viewportSize.width - stageDims.width) / 2
    );
    const stageContentY = Math.max(
      STAGE_PADDING,
      (viewportSize.height - stageDims.height) / 2
    );
    const originX = stageContentX - scrollPos.left;
    const originY = stageContentY - scrollPos.top;
    const pxPerCmX = stageDims.width / effectivePhysicalW;
    const pxPerCmY = stageDims.height / effectivePhysicalH;

    const cutStartX = originX + (cutBBoxPx.minX / Math.max(1, imageWidth)) * stageDims.width;
    const cutSpanW = (cutBBoxPx.widthPx / Math.max(1, imageWidth)) * stageDims.width;
    const cutStartY = originY + (cutBBoxPx.minY / Math.max(1, imageHeight)) * stageDims.height;
    const cutSpanH = (cutBBoxPx.heightPx / Math.max(1, imageHeight)) * stageDims.height;

    return {
      originX,
      originY,
      pxPerCmX,
      pxPerCmY,
      cutStartX,
      cutSpanW,
      cutStartY,
      cutSpanH,
      topTicks: buildCentimeterTicks(viewportSize.width, originX, pxPerCmX),
      leftTicks: buildCentimeterTicks(viewportSize.height, originY, pxPerCmY),
    };
  }, [
    viewportSize,
    stageDims,
    scrollPos,
    effectivePhysicalW,
    effectivePhysicalH,
    cutBBoxPx,
    imageWidth,
    imageHeight,
  ]);

  const pathD = useMemo(() => buildSvgPathD(anchors), [anchors]);
  const zoomScaleComp = Math.sqrt(Math.max(0.5, zoom / 100));
  const scaleFactor = useMemo(
    () => Math.max(imageWidth, imageHeight, 200) / 520 / zoomScaleComp,
    [imageWidth, imageHeight, zoomScaleComp]
  );

  // Semantic CutContour stroke color strictly from Design Tokens (Magenta or Cyan)
  const cutStrokeCss =
    cutContourTone === "cyan"
      ? "hsl(var(--cutcontour-cyan-hsl))"
      : "hsl(var(--cutcontour-magenta-hsl))";

  // Convert pointer client coordinates to SVG image-space coordinates
  const clientToSvgCoords = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const local = pt.matrixTransform(ctm.inverse());
      return {
        x: round2(Math.max(0, Math.min(imageWidth, local.x))),
        y: round2(Math.max(0, Math.min(imageHeight, local.y))),
      };
    },
    [imageWidth, imageHeight]
  );

  // Keyboard shortcuts (Undo/Redo, Tools, Space pan, Delete node, Reset Zoom)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.code === "Space") {
        e.preventDefault();
        setSpacePressed(true);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        onRedo();
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        handleTogglePoints();
        return;
      }
      if (e.key.toLowerCase() === "a") setTool("select");
      if (e.key.toLowerCase() === "h") setTool("pan");
      if (e.key === "+" || e.key === "=") setTool("add_point");
      if (e.key === "-") setTool("delete_point");
      if (e.key === "0") setZoom(100);

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedIndex !== null &&
        !cutLayerLocked &&
        anchors.length > 3
      ) {
        e.preventDefault();
        const next = anchors.filter((_, idx) => idx !== selectedIndex);
        onChangeAnchors(next, true);
        onSelectIndex(Math.min(selectedIndex, next.length - 1));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpacePressed(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    anchors,
    selectedIndex,
    cutLayerLocked,
    onChangeAnchors,
    onSelectIndex,
    onUndo,
    onRedo,
    handleTogglePoints,
  ]);

  const isPanMode = tool === "pan" || spacePressed;

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (isPanMode || e.button === 1) {
      const vp = viewportRef.current;
      if (!vp) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      isPanningRef.current = true;
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: vp.scrollLeft,
        scrollTop: vp.scrollTop,
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    // Update live centimeter cursor guides on both top & left rulers
    const livePos = clientToSvgCoords(e.clientX, e.clientY);
    if (livePos && imageWidth > 0 && imageHeight > 0) {
      setCursorCm({
        x: round2((livePos.x / imageWidth) * effectivePhysicalW),
        y: round2((livePos.y / imageHeight) * effectivePhysicalH),
      });
    }

    if (isPanningRef.current && panStartRef.current && viewportRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      viewportRef.current.scrollLeft = panStartRef.current.scrollLeft - dx;
      viewportRef.current.scrollTop = panStartRef.current.scrollTop - dy;
      setScrollPos({
        left: viewportRef.current.scrollLeft,
        top: viewportRef.current.scrollTop,
      });
      return;
    }

    if (!dragTarget || cutLayerLocked || !livePos) return;
    const pos = livePos;

    const pushHistoryOnce = !dragSnapshotPushedRef.current;
    dragSnapshotPushedRef.current = true;

    const next = anchors.map((item, idx) => {
      if (idx !== dragTarget.index) return item;

      if (dragTarget.kind === "anchor") {
        const dx = pos.x - item.x;
        const dy = pos.y - item.y;
        return {
          ...item,
          x: pos.x,
          y: pos.y,
          in_x: round2(item.in_x + dx),
          in_y: round2(item.in_y + dy),
          out_x: round2(item.out_x + dx),
          out_y: round2(item.out_y + dy),
        };
      }

      if (dragTarget.kind === "in") {
        if (e.altKey) {
          return { ...item, in_x: pos.x, in_y: pos.y, smooth: false };
        }
        if (item.smooth) {
          const vx = item.x - pos.x;
          const vy = item.y - pos.y;
          const vLen = Math.hypot(vx, vy);
          const rawOppLen = Math.hypot(item.out_x - item.x, item.out_y - item.y);
          const oppLen = rawOppLen > 0.5 ? rawOppLen : vLen;
          if (vLen > 0.5 && oppLen > 0.1) {
            return {
              ...item,
              in_x: pos.x,
              in_y: pos.y,
              out_x: round2(item.x + (vx / vLen) * oppLen),
              out_y: round2(item.y + (vy / vLen) * oppLen),
            };
          }
        }
        return { ...item, in_x: pos.x, in_y: pos.y };
      }

      if (e.altKey) {
        return { ...item, out_x: pos.x, out_y: pos.y, smooth: false };
      }
      if (item.smooth) {
        const vx = item.x - pos.x;
        const vy = item.y - pos.y;
        const vLen = Math.hypot(vx, vy);
        const rawOppLen = Math.hypot(item.in_x - item.x, item.in_y - item.y);
        const oppLen = rawOppLen > 0.5 ? rawOppLen : vLen;
        if (vLen > 0.5 && oppLen > 0.1) {
          return {
            ...item,
            out_x: pos.x,
            out_y: pos.y,
            in_x: round2(item.x + (vx / vLen) * oppLen),
            in_y: round2(item.y + (vy / vLen) * oppLen),
          };
        }
      }
      return { ...item, out_x: pos.x, out_y: pos.y };
    });

    onChangeAnchors(next, pushHistoryOnce);
  };

  const handlePointerUp = () => {
    isPanningRef.current = false;
    panStartRef.current = null;
    setDragTarget(null);
    dragSnapshotPushedRef.current = false;
  };

  const handlePointerLeave = () => {
    handlePointerUp();
    setCursorCm(null);
  };

  const handlePathClick = (e: React.MouseEvent<SVGPathElement>) => {
    if (cutLayerLocked || isPanMode) return;
    if (tool === "add_point" || e.detail === 2) {
      e.stopPropagation();
      const pos = clientToSvgCoords(e.clientX, e.clientY);
      if (!pos) return;
      const { next, insertedIndex } = insertAnchorOnNearestSegment(anchors, pos.x, pos.y);
      onChangeAnchors(next, true);
      onSelectIndex(insertedIndex);
      setTool("select");
    }
  };

  const handleAnchorPointerDown = (e: React.PointerEvent, index: number) => {
    if (isPanMode || e.button === 1) return;
    e.stopPropagation();
    if (cutLayerLocked) return;

    // Right-click on anchor: toggle node between smooth curve and sharp corner (without browser context menu)
    if (e.button === 2) {
      e.preventDefault();
      const toggled = toggleAnchorSmoothCorner(anchors, index);
      onChangeAnchors(toggled, true);
      onSelectIndex(index);
      return;
    }

    if (e.button !== 0) return;

    if (tool === "delete_point") {
      if (anchors.length <= 3) return;
      const next = anchors.filter((_, i) => i !== index);
      onChangeAnchors(next, true);
      onSelectIndex(null);
      return;
    }

    // Ensure visible directional handles when selecting a smooth node whose handles were collapsed
    if (anchors[index]?.smooth) {
      const expanded = ensureVisibleHandlesForAnchor(anchors, index);
      if (expanded !== anchors) {
        onChangeAnchors(expanded, false);
      }
    }

    onSelectIndex(index);
    setDragTarget({ kind: "anchor", index });
    dragSnapshotPushedRef.current = false;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const handleControlPointerDown = (
    e: React.PointerEvent,
    index: number,
    kind: "in" | "out"
  ) => {
    if (isPanMode || e.button !== 0) return;
    e.stopPropagation();
    if (cutLayerLocked) return;
    onSelectIndex(index);
    setDragTarget({ kind, index });
    dragSnapshotPushedRef.current = false;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const anchorRadius = Math.max(3.2, 5.0 * scaleFactor);
  const handleRadius = Math.max(2.3, 3.6 * scaleFactor);
  const strokeWidth = Math.max(1.2, 2.0 * scaleFactor);
  const cutLineStrokeWidth = Math.max(
    strokeWidth * 0.72,
    (Math.max(0.1, cutStrokeWidthPt) / 72) * dpi
  );
  const innerBorderStrokePx = Math.max(2, (Math.max(0.5, borderWidthMm) / 25.4) * dpi);
  const borderOffsetPx = Math.max(0, (Math.max(0, borderOffsetMm) / 25.4) * dpi);

  const cursorRulerX =
    cursorCm !== null ? rulerMetrics.originX + cursorCm.x * rulerMetrics.pxPerCmX : null;
  const cursorRulerY =
    cursorCm !== null ? rulerMetrics.originY + cursorCm.y * rulerMetrics.pxPerCmY : null;

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-sticker border border-darkroom-line bg-darkroom-surface text-darkroom-ink shadow-elevated"
    >
      {/* Darkroom Top Studio Bar: Telemetry + Show/Hide Points + CutContour Color + Undo/Redo + Zoom */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-darkroom-line/85 bg-darkroom-mat/95 px-3 py-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-darkroom-elevated text-sborg-emerald"
          >
            <Scissors className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <span className="block font-mono text-[11px] font-semibold tabular-nums text-darkroom-muted">
              <strong className="text-sborg-emerald">
                Corte {effectiveCutW.toFixed(1)}×{effectiveCutH.toFixed(1)} cm
              </strong>
              {targetSummaryLabel ? ` / ${targetSummaryLabel}` : ""}
              {` · ${anchors.length} nodos`}
              {whiteBorderMm > 0 ? ` · +${whiteBorderMm.toFixed(1)}mm blanco` : ""}
              {bleedMm > 0
                ? ` · ${cutDirection === "inside" ? "-" : "+"}${bleedMm.toFixed(1)}mm`
                : ""}
            </span>
          </div>

          {cutLayerLocked && (
            <span className="inline-flex items-center gap-1 rounded-full border border-preflight-warn-border bg-preflight-warn-bg px-2 py-0.5 font-mono text-[10px] font-bold text-preflight-warn-ink">
              <Lock className="h-2.5 w-2.5" aria-hidden="true" />
              Bloqueada
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Show / Hide Anchor Points & Bezier Handles Toggle (Shortcut: P) */}
          <button
            type="button"
            aria-pressed={effectiveShowPoints}
            onClick={handleTogglePoints}
            title={
              effectiveShowPoints
                ? "Ocultar puntos y manejadores Bézier (P) — ver solo línea CutContour"
                : "Mostrar puntos y manejadores Bézier (P)"
            }
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10px] font-bold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              effectiveShowPoints
                ? "border-darkroom-line bg-darkroom-elevated text-darkroom-ink shadow-xs hover:border-sborg-emerald/70"
                : "border-sborg-emerald/80 bg-darkroom-mat text-sborg-emerald shadow-xs hover:bg-darkroom-elevated"
            }`}
          >
            {effectiveShowPoints ? (
              <Eye className="h-3.5 w-3.5 text-sborg-emerald" aria-hidden="true" />
            ) : (
              <EyeOff className="h-3.5 w-3.5 text-sborg-emerald" aria-hidden="true" />
            )}
            <span>{effectiveShowPoints ? "Ocultar puntos" : "Mostrar puntos"}</span>
            <kbd className="hidden rounded-xs border border-darkroom-line bg-darkroom-surface px-1 py-px font-mono text-[9px] text-darkroom-muted sm:inline-block">
              P
            </kbd>
          </button>

          {/* High-Contrast CutContour Color Switcher (Magenta / Cyan) */}
          {onCutContourToneChange && (
            <div
              role="group"
              aria-label="Color de línea CutContour"
              className="inline-flex items-center rounded-md border border-darkroom-line bg-darkroom-mat p-0.5 font-mono text-[10px] font-bold"
            >
              <button
                type="button"
                aria-pressed={cutContourTone === "magenta"}
                onClick={() => onCutContourToneChange("magenta")}
                title="Trazado CutContour en Magenta de alto contraste"
                className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  cutContourTone === "magenta"
                    ? "bg-darkroom-elevated text-darkroom-ink shadow-xs"
                    : "text-darkroom-muted hover:text-darkroom-ink"
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-cutcontour-magenta" aria-hidden="true" />
                <span>Magenta</span>
              </button>
              <button
                type="button"
                aria-pressed={cutContourTone === "cyan"}
                onClick={() => onCutContourToneChange("cyan")}
                title="Trazado CutContour en Cian de alto contraste"
                className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  cutContourTone === "cyan"
                    ? "bg-darkroom-elevated text-darkroom-ink shadow-xs"
                    : "text-darkroom-muted hover:text-darkroom-ink"
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-cutcontour-cyan" aria-hidden="true" />
                <span>Cian</span>
              </button>
            </div>
          )}

          {/* Undo / Redo */}
          <div
            role="group"
            aria-label="Historial de edición"
            className="inline-flex items-center gap-0.5 rounded-md border border-darkroom-line bg-darkroom-mat p-0.5"
          >
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              title="Deshacer (Ctrl+Z)"
              aria-label="Deshacer"
              className="rounded-sm p-1.5 text-darkroom-muted transition-colors duration-fast hover:bg-darkroom-elevated hover:text-darkroom-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              title="Rehacer (Ctrl+Y)"
              aria-label="Rehacer"
              className="rounded-sm p-1.5 text-darkroom-muted transition-colors duration-fast hover:bg-darkroom-elevated hover:text-darkroom-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
            >
              <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {/* Zoom Controls */}
          <div
            role="group"
            aria-label="Controles de zoom"
            className="inline-flex items-center gap-0.5 rounded-md border border-darkroom-line bg-darkroom-mat p-0.5"
          >
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 25))}
              disabled={zoom <= MIN_ZOOM}
              aria-label="Alejar zoom"
              title="Alejar zoom (Ctrl + Rueda)"
              className="rounded-sm p-1.5 text-darkroom-muted transition-colors duration-fast hover:bg-darkroom-elevated hover:text-darkroom-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
            >
              <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(100)}
              title="Restablecer zoom al 100% (tecla 0)"
              className="min-w-[42px] rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-darkroom-ink transition-colors duration-fast hover:bg-darkroom-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {zoom}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 25))}
              disabled={zoom >= MAX_ZOOM}
              aria-label="Acercar zoom"
              title="Acercar zoom (Ctrl + Rueda)"
              className="rounded-sm p-1.5 text-darkroom-muted transition-colors duration-fast hover:bg-darkroom-elevated hover:text-darkroom-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
            >
              <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Quick-Access Illustrator-Style Bezier Editing Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-darkroom-line/80 bg-darkroom-surface px-3 py-1.5">
        <div
          role="group"
          aria-label="Herramientas vectoriales"
          className="flex flex-wrap items-center gap-1"
        >
          <button
            type="button"
            aria-pressed={tool === "select"}
            onClick={() => setTool("select")}
            title="Selección Directa (A) — Arrastra nodos y manejadores Bézier"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-bold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              tool === "select"
                ? "border-sborg-emerald bg-sborg-emerald text-sborg-midnight shadow-xs"
                : "border-transparent bg-transparent text-darkroom-muted hover:border-darkroom-line hover:bg-darkroom-elevated hover:text-darkroom-ink"
            }`}
          >
            <MousePointer2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Mover Nodos</span>
            <kbd
              className={`hidden rounded-xs px-1 font-mono text-[9px] sm:inline-block ${
                tool === "select"
                  ? "bg-sborg-midnight/15 text-sborg-midnight"
                  : "bg-darkroom-mat text-darkroom-muted"
              }`}
            >
              A
            </kbd>
          </button>

          <button
            type="button"
            aria-pressed={tool === "add_point"}
            onClick={() => setTool("add_point")}
            title="Añadir Punto (+) — Haz clic sobre la línea de corte para insertar un vértice"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-bold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              tool === "add_point"
                ? "border-sborg-emerald bg-sborg-emerald text-sborg-midnight shadow-xs"
                : "border-transparent bg-transparent text-darkroom-muted hover:border-darkroom-line hover:bg-darkroom-elevated hover:text-darkroom-ink"
            }`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Añadir Punto</span>
            <kbd
              className={`hidden rounded-xs px-1 font-mono text-[9px] sm:inline-block ${
                tool === "add_point"
                  ? "bg-sborg-midnight/15 text-sborg-midnight"
                  : "bg-darkroom-mat text-darkroom-muted"
              }`}
            >
              +
            </kbd>
          </button>

          <button
            type="button"
            aria-pressed={tool === "delete_point"}
            onClick={() => setTool("delete_point")}
            title="Eliminar Punto (-) — Haz clic en un nodo para quitarlo"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-bold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              tool === "delete_point"
                ? "border-preflight-crit-border bg-preflight-crit-bg text-preflight-crit-ink shadow-xs"
                : "border-transparent bg-transparent text-darkroom-muted hover:border-darkroom-line hover:bg-darkroom-elevated hover:text-darkroom-ink"
            }`}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Quitar Punto</span>
            <kbd
              className={`hidden rounded-xs px-1 font-mono text-[9px] sm:inline-block ${
                tool === "delete_point"
                  ? "bg-darkroom-mat/30 text-preflight-crit-ink"
                  : "bg-darkroom-mat text-darkroom-muted"
              }`}
            >
              -
            </kbd>
          </button>

          <button
            type="button"
            aria-pressed={tool === "pan"}
            onClick={() => setTool("pan")}
            title="Mano / Mover lienzo (H o mantener Espacio)"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-bold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              tool === "pan"
                ? "border-sborg-emerald bg-sborg-emerald text-sborg-midnight shadow-xs"
                : "border-transparent bg-transparent text-darkroom-muted hover:border-darkroom-line hover:bg-darkroom-elevated hover:text-darkroom-ink"
            }`}
          >
            <Hand className="h-3.5 w-3.5" aria-hidden="true" />
            <kbd
              className={`hidden rounded-xs px-1 font-mono text-[9px] sm:inline-block ${
                tool === "pan"
                  ? "bg-sborg-midnight/15 text-sborg-midnight"
                  : "bg-darkroom-mat text-darkroom-muted"
              }`}
            >
              H
            </kbd>
          </button>
        </div>

        <button
          type="button"
          onClick={onSmoothAllVertices}
          disabled={anchors.length < 3 || cutLayerLocked}
          title="Suavizar y redondear todos los vértices"
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-sborg-emerald/75 bg-darkroom-mat px-2.5 py-1 text-[11px] font-bold text-darkroom-ink transition-colors duration-fast hover:border-sborg-emerald hover:bg-darkroom-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
        >
          <Sparkles className="h-3.5 w-3.5 text-sborg-emerald" aria-hidden="true" />
          <span>Redondear todos</span>
        </button>
      </div>

      {/* Real-Scale Centimeter Rulers + Scrollable Darkroom Cutting-Mat Artboard */}
      <div
        className="relative grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: `${RULER_THICKNESS}px minmax(0, 1fr)`,
          gridTemplateRows: `${RULER_THICKNESS}px minmax(0, 1fr)`,
        }}
      >
        {/* Top-Left Ruler Origin Unit Box ("cm") */}
        <div
          aria-hidden="true"
          className="flex items-center justify-center border-b border-r border-darkroom-line bg-darkroom-mat font-mono text-[9px] font-extrabold uppercase tracking-tighter text-sborg-emerald select-none"
        >
          cm
        </div>

        {/* Top Horizontal Centimeter Ruler (Locked 1:1 to artboard width & scrollLeft) */}
        <div
          aria-hidden="true"
          className="relative overflow-hidden border-b border-darkroom-line bg-darkroom-mat select-none"
        >
          {artworkUrl && (
            <svg
              width={viewportSize.width}
              height={RULER_THICKNESS}
              className="block h-full w-full"
            >
              {/* Active artboard span highlight */}
              <rect
                x={rulerMetrics.originX}
                y={0}
                width={stageDims.width}
                height={RULER_THICKNESS}
                fill="hsl(var(--sborg-emerald-hsl) / 0.1)"
              />
              {/* Active CutContour horizontal span bar on top ruler */}
              {anchors.length >= 3 && (
                <rect
                  x={rulerMetrics.cutStartX}
                  y={RULER_THICKNESS - 2.5}
                  width={Math.max(2, rulerMetrics.cutSpanW)}
                  height={2.5}
                  fill={cutStrokeCss}
                  opacity={0.9}
                />
              )}
              {rulerMetrics.topTicks.map((tick, idx) => {
                const tickH = tick.kind === "major" ? 11 : tick.kind === "half" ? 7 : 4;
                return (
                  <g key={idx}>
                    <line
                      x1={tick.pos}
                      y1={RULER_THICKNESS - tickH}
                      x2={tick.pos}
                      y2={RULER_THICKNESS}
                      stroke={
                        tick.kind === "major"
                          ? "hsl(var(--darkroom-muted-hsl))"
                          : "hsl(var(--darkroom-line-hsl))"
                      }
                      strokeWidth={1}
                    />
                    {tick.label !== undefined && (
                      <text
                        x={tick.pos + 3}
                        y={10}
                        fill="hsl(var(--darkroom-muted-hsl))"
                        fontSize={9}
                        fontFamily="var(--font-mono)"
                        fontWeight={700}
                      >
                        {tick.label}
                      </text>
                    )}
                  </g>
                );
              })}
              {/* Live cursor position guide */}
              {cursorRulerX !== null && (
                <line
                  x1={cursorRulerX}
                  y1={0}
                  x2={cursorRulerX}
                  y2={RULER_THICKNESS}
                  stroke="hsl(var(--sborg-emerald-hsl))"
                  strokeWidth={1.5}
                />
              )}
            </svg>
          )}
        </div>

        {/* Left Vertical Centimeter Ruler (Locked 1:1 to artboard height & scrollTop) */}
        <div
          aria-hidden="true"
          className="relative overflow-hidden border-r border-darkroom-line bg-darkroom-mat select-none"
        >
          {artworkUrl && (
            <svg
              width={RULER_THICKNESS}
              height={viewportSize.height}
              className="block h-full w-full"
            >
              {/* Active artboard span highlight */}
              <rect
                x={0}
                y={rulerMetrics.originY}
                width={RULER_THICKNESS}
                height={stageDims.height}
                fill="hsl(var(--sborg-emerald-hsl) / 0.1)"
              />
              {/* Active CutContour vertical span bar on left ruler */}
              {anchors.length >= 3 && (
                <rect
                  x={RULER_THICKNESS - 2.5}
                  y={rulerMetrics.cutStartY}
                  width={2.5}
                  height={Math.max(2, rulerMetrics.cutSpanH)}
                  fill={cutStrokeCss}
                  opacity={0.9}
                />
              )}
              {rulerMetrics.leftTicks.map((tick, idx) => {
                const tickW = tick.kind === "major" ? 11 : tick.kind === "half" ? 7 : 4;
                return (
                  <g key={idx}>
                    <line
                      x1={RULER_THICKNESS - tickW}
                      y1={tick.pos}
                      x2={RULER_THICKNESS}
                      y2={tick.pos}
                      stroke={
                        tick.kind === "major"
                          ? "hsl(var(--darkroom-muted-hsl))"
                          : "hsl(var(--darkroom-line-hsl))"
                      }
                      strokeWidth={1}
                    />
                    {tick.label !== undefined && (
                      <text
                        x={10}
                        y={tick.pos - 3}
                        fill="hsl(var(--darkroom-muted-hsl))"
                        fontSize={9}
                        fontFamily="var(--font-mono)"
                        fontWeight={700}
                        transform={`rotate(-90 10 ${tick.pos - 3})`}
                      >
                        {tick.label}
                      </text>
                    )}
                  </g>
                );
              })}
              {/* Live cursor position guide */}
              {cursorRulerY !== null && (
                <line
                  x1={0}
                  y1={cursorRulerY}
                  x2={RULER_THICKNESS}
                  y2={cursorRulerY}
                  stroke="hsl(var(--sborg-emerald-hsl))"
                  strokeWidth={1.5}
                />
              )}
            </svg>
          )}
        </div>

        {/* Cutting-Mat Scrollable Vector Viewport */}
        <div className="bg-cutting-mat relative flex min-h-0 flex-1 overflow-hidden">
          {/* Precision Print-Shop Corner Registration Crop Marks */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-2.5 z-20 h-3 w-3 border-l-[1.5px] border-t-[1.5px] border-sborg-emerald/75"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-2.5 z-20 h-3 w-3 border-r-[1.5px] border-t-[1.5px] border-sborg-emerald/75"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-2.5 left-2.5 z-20 h-3 w-3 border-b-[1.5px] border-l-[1.5px] border-sborg-emerald/75"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-2.5 right-2.5 z-20 h-3 w-3 border-b-[1.5px] border-r-[1.5px] border-sborg-emerald/75"
          />

          {artworkUrl && (
            <>
              <span className="pointer-events-none absolute left-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-full border border-darkroom-line bg-darkroom-mat/90 px-2.5 py-0.5 font-mono text-[10px] font-bold text-darkroom-ink backdrop-blur-sm">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${
                    cutContourTone === "cyan" ? "bg-cutcontour-cyan" : "bg-cutcontour-magenta"
                  }`}
                />
                <span>
                  CutContour · {cutDirection === "inside" ? "Interior" : "Exterior"}
                </span>
                {whiteBorderMm > 0 && (
                  <span className="rounded-xs bg-sborg-white/15 px-1 py-px text-[9px] text-sborg-white">
                    +{whiteBorderMm.toFixed(1)}mm blanco
                  </span>
                )}
                {borderColor && (
                  <span
                    aria-hidden="true"
                    style={{ backgroundColor: borderColor }}
                    className="inline-block h-2.5 w-2.5 rounded-full border border-darkroom-line"
                  />
                )}
              </span>

              <span className="pointer-events-none absolute right-3 top-3 z-20 rounded-full border border-darkroom-line bg-darkroom-mat/90 px-2.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-darkroom-muted backdrop-blur-sm">
                {zoom}% · {dpi} DPI
              </span>
            </>
          )}

          {/* Scrollable Viewport */}
          <div
            ref={viewportRef}
            onScroll={(e) => {
              const target = e.currentTarget;
              setScrollPos({ left: target.scrollLeft, top: target.scrollTop });
            }}
            className="h-full min-h-[340px] w-full flex-1 overflow-auto"
          >
            <div className="flex min-h-full min-w-full p-5">
              {!artworkUrl ? (
                <div className="m-auto flex flex-col items-center justify-center px-4 text-center">
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-sborg-emerald/70 bg-darkroom-surface text-sborg-emerald"
                  >
                    <Scissors className="h-5 w-5" />
                  </span>
                  <p className="mt-2.5 font-display text-xs font-extrabold text-darkroom-ink">
                    Mesa vectorial lista
                  </p>
                  <p className="mt-0.5 text-[11px] text-darkroom-muted">
                    Selecciona un diseño o sube un PNG.
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    width: `${stageDims.width}px`,
                    height: `${stageDims.height}px`,
                  }}
                  className="bg-darkroom-checker relative m-auto shrink-0 overflow-hidden rounded-sm border border-dashed border-darkroom-line shadow-elevated"
                >
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${imageWidth} ${imageHeight}`}
                    onContextMenu={(e) => e.preventDefault()}
                    onPointerDown={handleSvgPointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerLeave={handlePointerLeave}
                    onClick={() => {
                      if (!isPanMode) onSelectIndex(null);
                    }}
                    className={`block h-full w-full select-none touch-none ${
                      isPanMode
                        ? "cursor-grab active:cursor-grabbing"
                        : tool === "add_point"
                        ? "cursor-crosshair"
                        : tool === "delete_point"
                        ? "cursor-not-allowed"
                        : "cursor-default"
                    }`}
                  >
                    {borderColor &&
                      pathD &&
                      (cutDirection === "inside" || borderCutPosition === "outside_base") && (
                        <defs>
                          {cutDirection === "inside" && (
                            <clipPath id={insideClipId}>
                              <path d={pathD} />
                            </clipPath>
                          )}
                          {borderCutPosition === "outside_base" && borderOffsetPx >= 0.5 && (
                            <mask id={outsideBaseMaskId}>
                              <path d={pathD} fill="white" />
                              <path
                                d={pathD}
                                fill="none"
                                stroke="black"
                                strokeWidth={borderOffsetPx * 2}
                                strokeLinejoin="round"
                                strokeLinecap="round"
                              />
                            </mask>
                          )}
                        </defs>
                      )}

                    {/* CAPA 1: DISEÑO (+ Margen blanco OpenCV + Borde base dinámico) */}
                    {showDesignLayer && (
                      <g id="Capa_1_Diseno" opacity={designOpacity / 100}>
                        {borderColor && pathD && borderCutPosition === "inside_base" && (
                          <path
                            d={pathD}
                            fill={borderColor}
                            stroke={borderColor}
                            strokeWidth={Math.max(1, borderOffsetPx * 2)}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            className="pointer-events-none"
                          />
                        )}
                        {borderColor && pathD && borderCutPosition === "outside_base" && (
                          <path
                            d={pathD}
                            fill={borderColor}
                            stroke="none"
                            mask={
                              borderOffsetPx >= 0.5 ? `url(#${outsideBaseMaskId})` : undefined
                            }
                            className="pointer-events-none"
                          />
                        )}
                        <image
                          href={artworkUrl}
                          x={0}
                          y={0}
                          width={imageWidth}
                          height={imageHeight}
                          preserveAspectRatio="xMidYMid meet"
                        />
                        {borderColor && cutDirection === "inside" && pathD && (
                          <path
                            d={pathD}
                            fill="none"
                            stroke={borderColor}
                            strokeWidth={innerBorderStrokePx * 2}
                            strokeLinejoin="round"
                            clipPath={`url(#${insideClipId})`}
                            className="pointer-events-none"
                          />
                        )}
                      </g>
                    )}

                    {/* CAPA 2: CORTE / TROQUEL (CutContour en Magenta / Cian de alto contraste) */}
                    {showCutLayer && pathD && (
                      <g id="Capa_2_Corte_CutContour">
                        {/* Wide transparent hit area for double-click / Add Point insertion */}
                        <path
                          d={pathD}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={strokeWidth * 6}
                          onClick={handlePathClick}
                          className={
                            isPanMode
                              ? "cursor-grab"
                              : tool === "add_point"
                              ? "cursor-crosshair"
                              : "cursor-pointer"
                          }
                        />

                        {/* Darkroom contrast halo so CutContour pops over white margins & bright art */}
                        <path
                          d={pathD}
                          fill="none"
                          stroke="hsl(var(--darkroom-mat-hsl))"
                          strokeOpacity={0.85}
                          strokeWidth={cutLineStrokeWidth * 2.15}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="pointer-events-none"
                        />

                        {/* CutContour plotter vector stroke (Magenta or Cyan semantic token) */}
                        <path
                          d={pathD}
                          fill="none"
                          stroke={cutStrokeCss}
                          strokeWidth={cutLineStrokeWidth}
                          strokeDasharray={
                            dashedPreview
                              ? `${cutLineStrokeWidth * 4} ${cutLineStrokeWidth * 2.5}`
                              : undefined
                          }
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="pointer-events-none"
                        />

                        {/* Editable Bezier Anchor Points (hidden when showPoints is false) */}
                        {!cutLayerLocked &&
                          effectiveShowPoints &&
                          anchors.map((pt, idx) => {
                            const isSelected = idx === selectedIndex;
                            return (
                              <circle
                                key={idx}
                                cx={pt.x}
                                cy={pt.y}
                                r={isSelected ? anchorRadius * 1.25 : anchorRadius}
                                fill={
                                  isSelected
                                    ? cutStrokeCss
                                    : pt.smooth
                                    ? "hsl(var(--sborg-white-hsl))"
                                    : "hsl(var(--darkroom-surface-hsl))"
                                }
                                stroke={
                                  isSelected
                                    ? "hsl(var(--sborg-white-hsl))"
                                    : pt.smooth
                                    ? "hsl(var(--darkroom-mat-hsl))"
                                    : cutStrokeCss
                                }
                                strokeWidth={strokeWidth * 0.9}
                                onContextMenu={(e) => e.preventDefault()}
                                onClick={(e) => e.stopPropagation()}
                                onPointerDown={(e) => handleAnchorPointerDown(e, idx)}
                                className={
                                  isPanMode
                                    ? "cursor-grab"
                                    : tool === "delete_point"
                                    ? "cursor-pointer"
                                    : "cursor-grab active:cursor-grabbing"
                                }
                              />
                            );
                          })}

                        {/* Bezier Directional Tangent Handles for Selected Anchor (rendered above anchors so handles are always easy to grab with left-click) */}
                        {!cutLayerLocked &&
                          effectiveShowPoints &&
                          selectedIndex !== null &&
                          anchors[selectedIndex] && (
                            <g>
                              <line
                                x1={anchors[selectedIndex].x}
                                y1={anchors[selectedIndex].y}
                                x2={anchors[selectedIndex].in_x}
                                y2={anchors[selectedIndex].in_y}
                                stroke="hsl(var(--sborg-emerald-hsl))"
                                strokeWidth={strokeWidth * 0.9}
                                className="pointer-events-none"
                              />
                              <line
                                x1={anchors[selectedIndex].x}
                                y1={anchors[selectedIndex].y}
                                x2={anchors[selectedIndex].out_x}
                                y2={anchors[selectedIndex].out_y}
                                stroke="hsl(var(--sborg-emerald-hsl))"
                                strokeWidth={strokeWidth * 0.9}
                                className="pointer-events-none"
                              />
                              <circle
                                cx={anchors[selectedIndex].in_x}
                                cy={anchors[selectedIndex].in_y}
                                r={handleRadius * 1.15}
                                fill="hsl(var(--sborg-emerald-hsl))"
                                stroke="hsl(var(--darkroom-mat-hsl))"
                                strokeWidth={strokeWidth * 0.7}
                                onContextMenu={(e) => e.preventDefault()}
                                onClick={(e) => e.stopPropagation()}
                                onPointerDown={(e) =>
                                  handleControlPointerDown(e, selectedIndex, "in")
                                }
                                className="cursor-grab active:cursor-grabbing"
                              />
                              <circle
                                cx={anchors[selectedIndex].out_x}
                                cy={anchors[selectedIndex].out_y}
                                r={handleRadius * 1.15}
                                fill="hsl(var(--sborg-emerald-hsl))"
                                stroke="hsl(var(--darkroom-mat-hsl))"
                                strokeWidth={strokeWidth * 0.7}
                                onContextMenu={(e) => e.preventDefault()}
                                onClick={(e) => e.stopPropagation()}
                                onPointerDown={(e) =>
                                  handleControlPointerDown(e, selectedIndex, "out")
                                }
                                className="cursor-grab active:cursor-grabbing"
                              />
                            </g>
                          )}
                      </g>
                    )}
                  </svg>
                </div>
              )}
            </div>
          </div>

          {loading && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-darkroom-mat/55 backdrop-blur-[1.5px]">
              <div className="flex items-center gap-2 rounded-full border border-dashed border-sborg-emerald bg-darkroom-surface px-4 py-2 text-xs font-bold text-darkroom-ink shadow-elevated">
                <Loader2 className="h-4 w-4 animate-spin text-sborg-emerald" aria-hidden="true" />
                <span>Calculando contorno vectorial y margen...</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Darkroom Compact Status Bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-darkroom-line/85 bg-darkroom-mat/95 px-3 py-1.5 text-[10px] text-darkroom-muted">
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
          title="Clic izquierdo selecciona nodo y arrastra manejadores · Alt + arrastrar rompe tangente · Clic derecho alterna curva/esquina · Doble clic añade nodo · P oculta/muestra puntos · Ctrl+Z/Y deshacer/rehacer"
        >
          <span>
            <kbd className="rounded-xs border border-darkroom-line bg-darkroom-surface px-1 py-px font-mono text-[9px] text-darkroom-ink">
              Alt
            </kbd>{" "}
            tangente
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <kbd className="rounded-xs border border-darkroom-line bg-darkroom-surface px-1 py-px font-mono text-[9px] text-darkroom-ink">
              Clic der.
            </kbd>{" "}
            curva/esquina
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <kbd className="rounded-xs border border-darkroom-line bg-darkroom-surface px-1 py-px font-mono text-[9px] text-darkroom-ink">
              P
            </kbd>{" "}
            puntos
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <kbd className="rounded-xs border border-darkroom-line bg-darkroom-surface px-1 py-px font-mono text-[9px] text-darkroom-ink">
              Ctrl+Z/Y
            </kbd>
          </span>
        </div>

        <div className="font-mono text-[10px] font-bold tabular-nums text-sborg-emerald">
          {cursorCm
            ? `X ${cursorCm.x.toFixed(1)} · Y ${cursorCm.y.toFixed(1)} cm · Corte ${effectiveCutW.toFixed(1)}×${effectiveCutH.toFixed(1)} cm`
            : `Corte ${effectiveCutW.toFixed(1)}×${effectiveCutH.toFixed(1)} cm · Lienzo ${effectivePhysicalW.toFixed(1)}×${effectivePhysicalH.toFixed(1)} cm · ${dpi} DPI`}
        </div>
      </div>
    </div>
  );
};
