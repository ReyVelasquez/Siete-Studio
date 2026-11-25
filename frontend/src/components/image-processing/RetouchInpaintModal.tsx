import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Brush,
  Check,
  Eraser,
  Eye,
  EyeOff,
  Hand,
  Layers,
  Loader2,
  Paintbrush,
  Pipette,
  RotateCcw,
  Scissors,
  Sparkles,
  SquareDashedMousePointer,
  Trash2,
  Undo2,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/hooks/useToast";
import { imageProcessingService } from "@/services/imageProcessing.service";
import type { RetouchMode, WatermarkTone } from "@/types/order";

type RetouchTool = "brush" | "rect" | "unmask" | "eyedropper" | "pan";

export interface RetouchInpaintModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceImageUrl: string | null;
  sourceLabel?: string;
  onApplyRetouched: (retouchedFile: File) => void;
}

const MIN_ZOOM = 50;
const MAX_ZOOM = 400;

const RETOUCH_MODES: readonly {
  id: RetouchMode;
  label: string;
  description: string;
  badge: string;
}[] = [
  {
    id: "inpaint_telea",
    label: "Relleno Inteligente",
    description: "Borra puntos, objetos o textos detectando el color base del fondo",
    badge: "Recomendado",
  },
  {
    id: "watermark_clean",
    label: "Marca de Agua",
    description: "Elimina marcas semitransparentes preservando colores base",
    badge: "Antimarca",
  },
  {
    id: "inpaint_ns",
    label: "Degradados / Textura",
    description: "Continúa gradientes suaves y contornos del fondo",
    badge: "Navier-Stokes",
  },
  {
    id: "erase_transparent",
    label: "Borrar a Transparente",
    description: "Recorta la zona marcada directamente al canal alfa PNG",
    badge: "PNG Alfa",
  },
];

// Matches Sborg Emerald (#01c38e) for Canvas 2D mask painting
const MASK_STROKE_COLOR = "#01c38e";

async function urlToPngFile(url: string, filename: string): Promise<File> {
  const response = await fetch(url);
  const blob = await response.blob();
  const mime = blob.type && blob.type.startsWith("image/") ? blob.type : "image/png";
  return new File([blob], filename, { type: mime });
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g)
    .toString(16)
    .padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`.toUpperCase();
}

export const RetouchInpaintModal: React.FC<RetouchInpaintModalProps> = ({
  isOpen,
  onClose,
  sourceImageUrl,
  sourceLabel = "Diseño actual",
  onApplyRetouched,
}) => {
  const { pushToast } = useToast();

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevSizeRef = useRef<{ width: number; height: number } | null>(null);

  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: 660,
    height: 440,
  });
  const [imgSize, setImgSize] = useState<{ width: number; height: number } | null>(null);
  const [initialUrl, setInitialUrl] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [imageHistory, setImageHistory] = useState<string[]>([]);

  // Tool, brush & zoom settings
  const [tool, setTool] = useState<RetouchTool>("brush");
  const [spacePressed, setSpacePressed] = useState<boolean>(false);
  const [brushSize, setBrushSize] = useState<number>(20);
  const [zoom, setZoom] = useState<number>(100);
  const [showMask, setShowMask] = useState<boolean>(true);
  const [compareOriginal, setCompareOriginal] = useState<boolean>(false);
  const [hasMaskStrokes, setHasMaskStrokes] = useState<boolean>(false);
  const [maskUndoCount, setMaskUndoCount] = useState<number>(0);

  // Base-color detector state (Auto vs manual Eyedropper override)
  const [lockedBaseColor, setLockedBaseColor] = useState<string | null>(null);
  const [lastDetectedBaseColor, setLastDetectedBaseColor] = useState<string | null>(null);

  // Backend inpainting parameters (0px dilate & 1px feather by default so small brushes stay surgical)
  const [mode, setMode] = useState<RetouchMode>("inpaint_telea");
  const [inpaintRadius, setInpaintRadius] = useState<number>(8);
  const [maskDilate, setMaskDilate] = useState<number>(0);
  const [maskFeather, setMaskFeather] = useState<number>(1);
  const [watermarkStrength, setWatermarkStrength] = useState<number>(88);

  // Auto watermark detection parameters
  const [wmTone, setWmTone] = useState<WatermarkTone>("light");
  const [wmSensitivity, setWmSensitivity] = useState<number>(58);

  // Processing flags
  const [applyingInpaint, setApplyingInpaint] = useState<boolean>(false);
  const [detectingWatermark, setDetectingWatermark] = useState<boolean>(false);
  const [savingToLab, setSavingToLab] = useState<boolean>(false);

  // Interactive pointer / drawing / panning refs
  const isDrawingRef = useRef<boolean>(false);
  const isPanningRef = useRef<boolean>(false);
  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(
    null
  );
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  const maskHistoryRef = useRef<ImageData[]>([]);
  const [rectPreview, setRectPreview] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const [cursorInfo, setCursorInfo] = useState<{
    x: number;
    y: number;
    diameter: number;
    visible: boolean;
  }>({ x: 0, y: 0, diameter: 24, visible: false });

  // Measure scroll viewport so 100% fits cleanly and >100% truly expands without clamping
  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen]);

  // Ctrl/Cmd + mouse wheel zoom directly over the artboard viewport
  useEffect(() => {
    if (!isOpen) return;
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 25 : -25;
      setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [isOpen]);

  // Compute exact CSS pixel dimensions for the dual-canvas stack matching natural aspect ratio
  const stageDims = useMemo(() => {
    const natW = imgSize?.width || 600;
    const natH = imgSize?.height || 600;
    const availW = Math.max(220, viewportSize.width - 48);
    const availH = Math.max(220, viewportSize.height - 48);
    const fitScale = Math.min(availW / natW, availH / natH);
    const factor = zoom / 100;
    return {
      width: Math.max(64, Math.round(natW * fitScale * factor)),
      height: Math.max(64, Math.round(natH * fitScale * factor)),
    };
  }, [imgSize, viewportSize, zoom]);

  // Reset modal session cleanly every time it opens
  useEffect(() => {
    if (!isOpen || !sourceImageUrl) return;
    setInitialUrl(sourceImageUrl);
    setCurrentUrl(sourceImageUrl);
    setImageHistory([]);
    setCompareOriginal(false);
    setShowMask(true);
    setZoom(100);
    setTool("brush");
    setSpacePressed(false);
    setLockedBaseColor(null);
    setLastDetectedBaseColor(null);
    setRectPreview(null);
    maskHistoryRef.current = [];
    setMaskUndoCount(0);
    setHasMaskStrokes(false);
    prevSizeRef.current = null;

    const msk = maskCanvasRef.current;
    if (msk) {
      msk.getContext("2d")?.clearRect(0, 0, msk.width, msk.height);
    }
  }, [isOpen, sourceImageUrl]);

  // Draw active (or original when comparing) image into imageCanvas whenever URL changes
  const activeDisplayUrl = compareOriginal ? initialUrl : currentUrl;

  useEffect(() => {
    if (!isOpen || !activeDisplayUrl) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const prev = prevSizeRef.current;
      const sizeChanged = !prev || prev.width !== w || prev.height !== h;
      prevSizeRef.current = { width: w, height: h };
      setImgSize({ width: w, height: h });

      const imgCanvas = imageCanvasRef.current;
      if (imgCanvas) {
        imgCanvas.width = w;
        imgCanvas.height = h;
        const ctx = imgCanvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
        }
      }

      const mskCanvas = maskCanvasRef.current;
      if (mskCanvas && sizeChanged) {
        mskCanvas.width = w;
        mskCanvas.height = h;
        mskCanvas.getContext("2d")?.clearRect(0, 0, w, h);
        maskHistoryRef.current = [];
        setMaskUndoCount(0);
        setHasMaskStrokes(false);
      }
    };
    img.src = activeDisplayUrl;
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeDisplayUrl]);

  const checkMaskHasPixels = useCallback((): boolean => {
    const canvas = maskCanvasRef.current;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] > 10) return true;
    }
    return false;
  }, []);

  const pushMaskSnapshot = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
    maskHistoryRef.current = [...maskHistoryRef.current.slice(-19), snap];
    setMaskUndoCount(maskHistoryRef.current.length);
  }, []);

  const handleClearMask = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (hasMaskStrokes) {
      pushMaskSnapshot();
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasMaskStrokes(false);
  }, [hasMaskStrokes, pushMaskSnapshot]);

  const handleUndoMaskStroke = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas || maskHistoryRef.current.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const prev = maskHistoryRef.current.pop()!;
    ctx.putImageData(prev, 0, 0);
    setMaskUndoCount(maskHistoryRef.current.length);
    setHasMaskStrokes(checkMaskHasPixels());
  }, [checkMaskHasPixels]);

  const handleUndoAppliedPass = useCallback(() => {
    setImageHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setCurrentUrl(last);
      setCompareOriginal(false);
      return prev.slice(0, -1);
    });
  }, []);

  const handleRestoreInitial = () => {
    if (!initialUrl) return;
    setCurrentUrl(initialUrl);
    setImageHistory([]);
    setCompareOriginal(false);
    handleClearMask();
    pushToast({
      title: "Imagen restaurada al original",
      variant: "info",
    });
  };

  // Illustrator-style keyboard shortcuts while modal is open
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.code === "Space") {
        e.preventDefault();
        setSpacePressed(true);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (maskHistoryRef.current.length > 0) {
          handleUndoMaskStroke();
        } else if (imageHistory.length > 0) {
          handleUndoAppliedPass();
        }
        return;
      }

      const lower = e.key.toLowerCase();
      if (lower === "b") setTool("brush");
      else if (lower === "r") setTool("rect");
      else if (lower === "e") setTool("unmask");
      else if (lower === "i") setTool("eyedropper");
      else if (lower === "h") setTool("pan");
      else if (lower === "m") setShowMask((v) => !v);
      else if (e.key === "[") setBrushSize((s) => Math.max(2, s - (s <= 12 ? 2 : 6)));
      else if (e.key === "]") setBrushSize((s) => Math.min(120, s + (s < 12 ? 2 : 6)));
      else if (e.key === "+" || e.key === "=")
        setZoom((z) => Math.min(MAX_ZOOM, z + 25));
      else if (e.key === "-") setZoom((z) => Math.max(MIN_ZOOM, z - 25));
      else if (e.key === "0") setZoom(100);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpacePressed(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [isOpen, handleUndoMaskStroke, handleUndoAppliedPass, imageHistory.length]);

  const sampleBaseColorAt = (x: number, y: number) => {
    const imgCanvas = imageCanvasRef.current;
    if (!imgCanvas) return;
    const ctx = imgCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const sx = Math.max(0, Math.min(imgCanvas.width - 1, Math.round(x) - 1));
    const sy = Math.max(0, Math.min(imgCanvas.height - 1, Math.round(y) - 1));
    const sw = Math.min(3, imgCanvas.width - sx);
    const sh = Math.min(3, imgCanvas.height - sy);
    const data = ctx.getImageData(sx, sy, sw, sh).data;

    const rs: number[] = [];
    const gs: number[] = [];
    const bs: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 20) {
        rs.push(data[i]);
        gs.push(data[i + 1]);
        bs.push(data[i + 2]);
      }
    }
    if (rs.length === 0) return;
    rs.sort((a, b) => a - b);
    gs.sort((a, b) => a - b);
    bs.sort((a, b) => a - b);
    const mid = Math.floor(rs.length / 2);
    const hex = rgbToHex(rs[mid], gs[mid], bs[mid]);
    setLockedBaseColor(hex);
    setTool("brush");
    pushToast({
      title: `Color base fijado: ${hex}`,
      description: "El borrador reconstruirá el fondo respetando este color base exacto.",
      variant: "success",
    });
  };

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      cssX: e.clientX - rect.left,
      cssY: e.clientY - rect.top,
      cssDiameter: Math.max(4, brushSize / scaleX),
    };
  };

  const paintStrokeSegment = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    activeTool: RetouchTool
  ) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushSize;

    if (activeTool === "unmask") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.fillStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = MASK_STROKE_COLOR;
      ctx.fillStyle = MASK_STROKE_COLOR;
    }

    if (from.x === to.x && from.y === to.y) {
      ctx.beginPath();
      ctx.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.restore();
  };

  const isPanMode = tool === "pan" || spacePressed;

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Allow Hand tool, Space+drag, or middle mouse button panning at any zoom level
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
      return;
    }

    if (compareOriginal || applyingInpaint || detectingWatermark) return;
    const pt = getCanvasPoint(e);
    if (!pt) return;

    if (tool === "eyedropper") {
      sampleBaseColorAt(pt.x, pt.y);
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    setShowMask(true);
    pushMaskSnapshot();
    isDrawingRef.current = true;

    if (tool === "rect") {
      setRectPreview({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
      lastPtRef.current = { x: pt.x, y: pt.y };
      return;
    }

    lastPtRef.current = { x: pt.x, y: pt.y };
    paintStrokeSegment(pt, pt, tool);
    if (tool === "brush") setHasMaskStrokes(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPanningRef.current && panStartRef.current && viewportRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      viewportRef.current.scrollLeft = panStartRef.current.scrollLeft - dx;
      viewportRef.current.scrollTop = panStartRef.current.scrollTop - dy;
      return;
    }

    const pt = getCanvasPoint(e);
    if (!pt) return;

    setCursorInfo({
      x: pt.cssX,
      y: pt.cssY,
      diameter: pt.cssDiameter,
      visible:
        !isPanMode &&
        (tool === "brush" || tool === "unmask") &&
        !compareOriginal,
    });

    if (!isDrawingRef.current || !lastPtRef.current) return;

    if (tool === "rect") {
      setRectPreview((prev) =>
        prev ? { ...prev, x1: pt.x, y1: pt.y } : { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y }
      );
      return;
    }

    paintStrokeSegment(lastPtRef.current, pt, tool);
    lastPtRef.current = { x: pt.x, y: pt.y };
  };

  const handlePointerUp = () => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      panStartRef.current = null;
      return;
    }

    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    if (tool === "rect" && rectPreview) {
      const canvas = maskCanvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (ctx) {
        const x = Math.min(rectPreview.x0, rectPreview.x1);
        const y = Math.min(rectPreview.y0, rectPreview.y1);
        const rw = Math.abs(rectPreview.x1 - rectPreview.x0);
        const rh = Math.abs(rectPreview.y1 - rectPreview.y0);
        if (rw >= 2 && rh >= 2) {
          ctx.save();
          ctx.globalCompositeOperation = "source-over";
          ctx.fillStyle = MASK_STROKE_COLOR;
          ctx.fillRect(x, y, rw, rh);
          ctx.restore();
          setHasMaskStrokes(true);
        }
      }
      setRectPreview(null);
    } else if (tool === "unmask") {
      setHasMaskStrokes(checkMaskHasPixels());
    }

    lastPtRef.current = null;
  };

  const handleRunInpaint = async () => {
    if (!currentUrl || !maskCanvasRef.current) return;
    if (!hasMaskStrokes) {
      pushToast({
        title: "Pinta primero la zona a borrar",
        description: "Usa el Borrador Mágico (B) o Rectángulo (R) sobre la marca de agua o elemento.",
        variant: "info",
      });
      return;
    }

    setApplyingInpaint(true);
    try {
      const maskBlob = await new Promise<Blob>((resolve, reject) => {
        maskCanvasRef.current!.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("No se pudo exportar la máscara pintada."));
        }, "image/png");
      });

      const imageFile = await urlToPngFile(currentUrl, "retouch-working.png");
      const res = await imageProcessingService.retouchInpaint({
        imageFile,
        maskBlob,
        mode,
        inpaintRadius,
        maskFeather,
        maskDilate,
        watermarkStrength,
        baseColor: lockedBaseColor,
      });

      setImageHistory((prev) => [...prev.slice(-14), currentUrl]);
      setCurrentUrl(res.preview_data_url);
      setCompareOriginal(false);
      if (res.detected_base_color) {
        setLastDetectedBaseColor(res.detected_base_color);
      }

      // Clear mask layer cleanly so user is ready for another pass
      const ctx = maskCanvasRef.current.getContext("2d");
      ctx?.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
      maskHistoryRef.current = [];
      setMaskUndoCount(0);
      setHasMaskStrokes(false);

      const baseTag = res.detected_base_color
        ? ` · Color base ${res.detected_base_color}`
        : "";
      pushToast({
        title:
          mode === "erase_transparent"
            ? "Zona borrada a transparente"
            : "Zona eliminada preservando el fondo",
        description: `${res.masked_percent}% del área procesada en ${res.processing_time_ms} ms${baseTag}.`,
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: "No se pudo aplicar el borrado",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setApplyingInpaint(false);
    }
  };

  const handleDetectWatermark = async () => {
    if (!currentUrl || !maskCanvasRef.current) return;
    setDetectingWatermark(true);
    try {
      const imageFile = await urlToPngFile(currentUrl, "watermark-scan.png");
      const res = await imageProcessingService.detectWatermarkMask({
        imageFile,
        tone: wmTone,
        sensitivity: wmSensitivity,
      });

      if (res.detected_pixels === 0) {
        pushToast({
          title: "Sin trazos de marca detectados",
          description: "Prueba subir la sensibilidad o marcar manualmente con el Borrador Mágico (B).",
          variant: "info",
        });
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const maskImg = new Image();
        maskImg.onload = () => {
          const canvas = maskCanvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (canvas && ctx) {
            pushMaskSnapshot();
            ctx.drawImage(maskImg, 0, 0, canvas.width, canvas.height);
            setShowMask(true);
            setHasMaskStrokes(true);
            setMode("watermark_clean");
          }
          resolve();
        };
        maskImg.onerror = () => reject(new Error("No se pudo cargar la máscara detectada."));
        maskImg.src = res.mask_data_url;
      });

      pushToast({
        title: "Marca de agua detectada en máscara editable",
        description: `Se marcaron ${res.detected_percent}% de píxeles. Ajusta con Desmarcar (E) si deseas y pulsa "Borrar zona marcada".`,
        variant: "success",
      });
    } catch (err) {
      pushToast({
        title: "Error al detectar marca de agua",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setDetectingWatermark(false);
    }
  };

  const handleConfirmApply = async () => {
    if (!currentUrl) return;
    setSavingToLab(true);
    try {
      const safeBase = sourceLabel.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "sticker";
      const file = await urlToPngFile(currentUrl, `${safeBase}_limpio.png`);
      onApplyRetouched(file);
      onClose();
    } catch (err) {
      pushToast({
        title: "No se pudo transferir la imagen al laboratorio",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setSavingToLab(false);
    }
  };

  const hasAppliedEdits = imageHistory.length > 0;
  const activeSwatchColor = lockedBaseColor || lastDetectedBaseColor;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Estudio de Borrador Inteligente y Marcas de Agua"
      subtitle={`Estilo Illustrator · Pasa el borrador sobre lo que deseas eliminar conservando el color base del fondo (${sourceLabel})`}
      maxWidthClass="max-w-6xl"
    >
      <div className="space-y-4">
        {/* Top Illustrator-Style Studio Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-line-subtle bg-surface-elevated/75 p-2.5 shadow-xs">
          {/* Drawing & Navigation Tools */}
          <div
            role="group"
            aria-label="Herramientas de borrador"
            className="flex flex-wrap items-center gap-1"
          >
            <button
              type="button"
              aria-pressed={tool === "brush"}
              onClick={() => {
                setTool("brush");
                setCompareOriginal(false);
              }}
              title="Borrador Mágico (B) — Pinta sobre lo que deseas borrar"
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-bold transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tool === "brush"
                  ? "border-accent bg-accent text-accent-ink shadow-xs"
                  : "border-transparent text-ink-secondary hover:border-line-subtle hover:bg-surface-card hover:text-ink-primary"
              }`}
            >
              <Brush className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Borrador</span>
              <kbd
                className={`hidden rounded-xs px-1 font-mono text-[9px] sm:inline-block ${
                  tool === "brush"
                    ? "bg-accent-ink/15 text-accent-ink"
                    : "bg-surface-card text-ink-muted"
                }`}
              >
                B
              </kbd>
            </button>

            <button
              type="button"
              aria-pressed={tool === "rect"}
              onClick={() => {
                setTool("rect");
                setCompareOriginal(false);
              }}
              title="Selección Rectangular (R) — Arrastra sobre marcas horizontales o logotipos"
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-bold transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tool === "rect"
                  ? "border-accent bg-accent text-accent-ink shadow-xs"
                  : "border-transparent text-ink-secondary hover:border-line-subtle hover:bg-surface-card hover:text-ink-primary"
              }`}
            >
              <SquareDashedMousePointer className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden md:inline">Rectángulo</span>
              <kbd
                className={`hidden rounded-xs px-1 font-mono text-[9px] sm:inline-block ${
                  tool === "rect"
                    ? "bg-accent-ink/15 text-accent-ink"
                    : "bg-surface-card text-ink-muted"
                }`}
              >
                R
              </kbd>
            </button>

            <button
              type="button"
              aria-pressed={tool === "unmask"}
              onClick={() => {
                setTool("unmask");
                setCompareOriginal(false);
              }}
              title="Desmarcar (E) — Quita partes de la máscara pintada por error"
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-bold transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tool === "unmask"
                  ? "border-line-diecut bg-accent-soft text-ink-primary shadow-xs"
                  : "border-transparent text-ink-secondary hover:border-line-subtle hover:bg-surface-card hover:text-ink-primary"
              }`}
            >
              <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden md:inline">Desmarcar</span>
              <kbd className="hidden rounded-xs bg-surface-card px-1 font-mono text-[9px] text-ink-muted sm:inline-block">
                E
              </kbd>
            </button>

            <button
              type="button"
              aria-pressed={tool === "eyedropper"}
              onClick={() => {
                setTool("eyedropper");
                setCompareOriginal(false);
              }}
              title="Cuentagotas Color Base (I) — Haz clic en el color de fondo que deseas conservar"
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-bold transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tool === "eyedropper"
                  ? "border-accent bg-accent text-accent-ink shadow-xs"
                  : "border-transparent text-ink-secondary hover:border-line-subtle hover:bg-surface-card hover:text-ink-primary"
              }`}
            >
              <Pipette className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden lg:inline">Color Base</span>
              <kbd
                className={`hidden rounded-xs px-1 font-mono text-[9px] sm:inline-block ${
                  tool === "eyedropper"
                    ? "bg-accent-ink/15 text-accent-ink"
                    : "bg-surface-card text-ink-muted"
                }`}
              >
                I
              </kbd>
            </button>

            <button
              type="button"
              aria-pressed={tool === "pan"}
              onClick={() => setTool("pan")}
              title="Mover lienzo / Mano (H o mantener Espacio)"
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-bold transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tool === "pan"
                  ? "border-accent bg-accent text-accent-ink shadow-xs"
                  : "border-transparent text-ink-secondary hover:border-line-subtle hover:bg-surface-card hover:text-ink-primary"
              }`}
            >
              <Hand className="h-3.5 w-3.5" aria-hidden="true" />
              <kbd
                className={`hidden rounded-xs px-1 font-mono text-[9px] sm:inline-block ${
                  tool === "pan"
                    ? "bg-accent-ink/15 text-accent-ink"
                    : "bg-surface-card text-ink-muted"
                }`}
              >
                H
              </kbd>
            </button>
          </div>

          {/* Brush Size Slider */}
          <div className="flex items-center gap-2 rounded-md border border-line-subtle bg-surface-card px-2.5 py-1 text-xs">
            <Paintbrush className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
            <span className="hidden text-[11px] font-semibold text-ink-secondary xl:inline">
              Grosor
            </span>
            <input
              type="range"
              min={2}
              max={120}
              step={1}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              aria-label="Tamaño del borrador"
              className="h-1.5 w-20 cursor-pointer appearance-none rounded-full bg-surface-elevated accent-accent sm:w-24"
            />
            <span className="min-w-[36px] text-right font-mono text-[11px] font-bold tabular-nums text-ink-primary">
              {brushSize}px
            </span>
          </div>

          {/* Mask Controls, Before/After & Working Zoom */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={handleUndoMaskStroke}
              disabled={maskUndoCount === 0}
              title="Deshacer trazo (Ctrl+Z)"
              className="inline-flex h-8 items-center gap-1 rounded-md border border-line-subtle bg-surface-card px-2 text-xs font-semibold text-ink-secondary transition-colors duration-fast ease-studio hover:border-line-strong hover:text-ink-primary disabled:opacity-35"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden xl:inline">Trazo</span>
            </button>

            <button
              type="button"
              onClick={handleClearMask}
              disabled={!hasMaskStrokes}
              title="Limpiar máscara pintada"
              className="inline-flex h-8 items-center gap-1 rounded-md border border-line-subtle bg-surface-card px-2 text-xs font-semibold text-ink-secondary transition-colors duration-fast ease-studio hover:border-line-strong hover:text-ink-primary disabled:opacity-35"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            <button
              type="button"
              aria-pressed={showMask}
              onClick={() => setShowMask((v) => !v)}
              title="Mostrar/ocultar máscara (M)"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line-subtle bg-surface-card text-ink-secondary transition-colors duration-fast ease-studio hover:border-line-strong hover:text-ink-primary"
            >
              {showMask ? (
                <Eye className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>

            {hasAppliedEdits && (
              <button
                type="button"
                aria-pressed={compareOriginal}
                onClick={() => setCompareOriginal((v) => !v)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-bold transition-all duration-fast ease-studio ${
                  compareOriginal
                    ? "border-accent bg-accent text-accent-ink shadow-xs"
                    : "border-dashed border-line-diecut/75 bg-accent-soft/55 text-ink-primary hover:border-line-diecut"
                }`}
              >
                <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{compareOriginal ? "Viendo Original" : "Ver Original"}</span>
              </button>
            )}

            <div className="inline-flex h-8 items-center rounded-md border border-line-subtle bg-surface-card p-0.5 shadow-xs">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 25))}
                disabled={zoom <= MIN_ZOOM}
                aria-label="Alejar zoom"
                title="Alejar zoom (- o Ctrl + Rueda)"
                className="rounded-sm p-1 text-ink-secondary hover:bg-surface-elevated hover:text-ink-primary disabled:opacity-35"
              >
                <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(100)}
                title="Ajustar al 100% (tecla 0)"
                className="min-w-[42px] px-1 font-mono text-[10px] font-bold tabular-nums text-ink-primary hover:bg-surface-elevated"
              >
                {zoom}%
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 25))}
                disabled={zoom >= MAX_ZOOM}
                aria-label="Acercar zoom"
                title="Acercar zoom (+ o Ctrl + Rueda)"
                className="rounded-sm p-1 text-ink-secondary hover:bg-surface-elevated hover:text-ink-primary disabled:opacity-35"
              >
                <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        {/* Main Split Modal Workspace */}
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
          {/* Left: Interactive Dual-Layer Canvas Artboard with True Scrollable Zoom */}
          <div className="space-y-2.5 lg:col-span-8">
            <div className="die-cut-zone bg-transparency-grid relative overflow-hidden rounded-sticker">
              {/* Pinned Corner Print Registration Marks */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-2.5 z-20 h-3 w-3 border-l-[1.5px] border-t-[1.5px] border-line-diecut/65"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-2.5 top-2.5 z-20 h-3 w-3 border-r-[1.5px] border-t-[1.5px] border-line-diecut/65"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-2.5 left-2.5 z-20 h-3 w-3 border-b-[1.5px] border-l-[1.5px] border-line-diecut/65"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-2.5 right-2.5 z-20 h-3 w-3 border-b-[1.5px] border-r-[1.5px] border-line-diecut/65"
              />

              {/* Pinned Floating Status Badge */}
              <span className="sticker-badge pointer-events-none absolute left-3 top-3 z-20 rounded-full border border-dashed border-line-diecut/75 bg-surface-card/95 px-2.5 py-0.5 font-mono text-[10px] font-bold text-ink-primary">
                {compareOriginal
                  ? "Imagen Original"
                  : tool === "eyedropper"
                  ? "Haz clic en el color base del fondo"
                  : isPanMode
                  ? "Arrastra para mover el lienzo"
                  : hasAppliedEdits
                  ? `Editado (${imageHistory.length} paso${imageHistory.length > 1 ? "s" : ""})`
                  : "Pinta la zona a borrar"}
              </span>

              {imgSize && (
                <span className="pointer-events-none absolute right-3 top-3 z-20 rounded-full border border-line-subtle bg-surface-card/90 px-2.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-ink-secondary shadow-xs">
                  {imgSize.width}×{imgSize.height} px · {zoom}%
                </span>
              )}

              {/* True Scrollable Viewport (m-auto centers cleanly when <= viewport and scrolls safely when > viewport) */}
              <div
                ref={viewportRef}
                className="h-[410px] w-full overflow-auto sm:h-[500px]"
              >
                <div className="flex min-h-full min-w-full p-6">
                  <div
                    style={{
                      width: `${stageDims.width}px`,
                      height: `${stageDims.height}px`,
                    }}
                    className="relative m-auto shrink-0"
                  >
                    <canvas
                      ref={imageCanvasRef}
                      className="block h-full w-full rounded-sm shadow-elevated"
                    />

                    <canvas
                      ref={maskCanvasRef}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerLeave={() => {
                        handlePointerUp();
                        setCursorInfo((c) => ({ ...c, visible: false }));
                      }}
                      className={`absolute inset-0 h-full w-full touch-none rounded-sm transition-opacity duration-fast ${
                        showMask && !compareOriginal ? "opacity-60" : "opacity-0"
                      } ${
                        isPanMode
                          ? "cursor-grab active:cursor-grabbing"
                          : compareOriginal
                          ? "cursor-default"
                          : tool === "rect" || tool === "eyedropper"
                          ? "cursor-crosshair"
                          : "cursor-none"
                      }`}
                    />

                    {/* Live Rectangular Marquee Preview */}
                    {rectPreview && imgSize && (
                      <div
                        aria-hidden="true"
                        style={{
                          left: `${(Math.min(rectPreview.x0, rectPreview.x1) / imgSize.width) * 100}%`,
                          top: `${(Math.min(rectPreview.y0, rectPreview.y1) / imgSize.height) * 100}%`,
                          width: `${(Math.abs(rectPreview.x1 - rectPreview.x0) / imgSize.width) * 100}%`,
                          height: `${(Math.abs(rectPreview.y1 - rectPreview.y0) / imgSize.height) * 100}%`,
                        }}
                        className="pointer-events-none absolute z-10 border-2 border-dashed border-accent bg-accent/25"
                      />
                    )}

                    {/* Exact Scaled Circular Brush Ring Cursor */}
                    {cursorInfo.visible && (
                      <div
                        aria-hidden="true"
                        style={{
                          left: `${cursorInfo.x}px`,
                          top: `${cursorInfo.y}px`,
                          width: `${cursorInfo.diameter}px`,
                          height: `${cursorInfo.diameter}px`,
                        }}
                        className={`pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-xs ${
                          tool === "unmask"
                            ? "border-dashed border-ink-primary bg-surface-card/25"
                            : "border-accent bg-accent/20"
                        }`}
                      />
                    )}
                  </div>
                </div>
              </div>

              {(applyingInpaint || detectingWatermark) && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-brand-950/50 backdrop-blur-[2px]">
                  <div className="sticker-badge flex items-center gap-2 rounded-full border border-dashed border-line-diecut bg-surface-card px-4 py-2 text-xs font-bold text-ink-primary shadow-elevated">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
                    <span>
                      {detectingWatermark
                        ? "Escaneando trazos de marca de agua..."
                        : "Detectando color base y reconstruyendo fondo..."}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line-subtle/70 bg-surface-elevated/55 px-3 py-2 text-[11px] text-ink-muted">
              <span>
                <kbd className="rounded-xs border border-line-subtle bg-surface-card px-1 py-0.5 font-mono text-[10px] font-bold text-ink-primary">
                  B
                </kbd>{" "}
                Borrador
              </span>
              <span>·</span>
              <span>
                <kbd className="rounded-xs border border-line-subtle bg-surface-card px-1 py-0.5 font-mono text-[10px] font-bold text-ink-primary">
                  I
                </kbd>{" "}
                Color base
              </span>
              <span>·</span>
              <span>
                <kbd className="rounded-xs border border-line-subtle bg-surface-card px-1 py-0.5 font-mono text-[10px] font-bold text-ink-primary">
                  Espacio / H
                </kbd>{" "}
                Mover lienzo
              </span>
              <span>·</span>
              <span>
                <kbd className="rounded-xs border border-line-subtle bg-surface-card px-1 py-0.5 font-mono text-[10px] font-bold text-ink-primary">
                  Ctrl + Rueda
                </kbd>{" "}
                Zoom (50–400%)
              </span>
              <span>·</span>
              <span>
                <kbd className="rounded-xs border border-line-subtle bg-surface-card px-1 py-0.5 font-mono text-[10px] font-bold text-ink-primary">
                  [ / ]
                </kbd>{" "}
                Pincel
              </span>
            </div>
          </div>

          {/* Right: Base-Color Detector, Retouch Mode, Precision Sliders & Auto Watermark Assistant */}
          <div className="space-y-4 lg:col-span-4">
            {/* 1. Smart Base-Color Detector Panel */}
            {mode !== "erase_transparent" && (
              <div className="space-y-2.5 rounded-sticker border border-dashed border-line-diecut/80 bg-accent-soft/40 p-3.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-extrabold text-ink-primary">
                    <Pipette className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    <span>Detector de Color Base</span>
                  </div>
                  <span className="rounded-full bg-surface-card px-2 py-0.5 font-mono text-[10px] font-bold text-accent">
                    {lockedBaseColor ? "Fijado" : "Auto CIELAB"}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 rounded-md border border-line-subtle bg-surface-card p-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      aria-hidden="true"
                      style={
                        activeSwatchColor ? { backgroundColor: activeSwatchColor } : undefined
                      }
                      className={`h-6 w-6 shrink-0 rounded-sm border border-line-strong shadow-xs ${
                        activeSwatchColor ? "" : "bg-transparency-grid"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-bold text-ink-primary">
                        {lockedBaseColor
                          ? `Color fijado (${lockedBaseColor})`
                          : lastDetectedBaseColor
                          ? `Último detectado (${lastDetectedBaseColor})`
                          : "Detección automática anti-manchas"}
                      </p>
                      <p className="truncate text-[10px] text-ink-muted">
                        Ignora bordes oscuros o puntos vecinos al rellenar
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setTool("eyedropper");
                        setCompareOriginal(false);
                      }}
                      title="Elegir color base del lienzo con cuentagotas (I)"
                      className={`rounded-md border px-2 py-1 text-[10px] font-bold transition-colors ${
                        tool === "eyedropper"
                          ? "border-accent bg-accent text-accent-ink"
                          : "border-line-subtle bg-surface-elevated text-ink-primary hover:border-line-diecut"
                      }`}
                    >
                      Muestrear
                    </button>
                    {lockedBaseColor && (
                      <button
                        type="button"
                        onClick={() => setLockedBaseColor(null)}
                        title="Volver a detección automática"
                        className="rounded-md border border-line-subtle bg-surface-elevated p-1 text-ink-secondary hover:border-line-strong hover:text-ink-primary"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 2. Background-Preserving Removal Mode */}
            <div className="space-y-2 rounded-sticker border border-line-subtle bg-surface-elevated/45 p-3.5">
              <div className="flex items-center gap-2 text-xs font-extrabold text-ink-primary">
                <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                <span>Modo de Reconstrucción del Fondo</span>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {RETOUCH_MODES.map((item) => {
                  const active = mode === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setMode(item.id)}
                      className={`rounded-lg border p-2.5 text-left transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        active
                          ? "border-accent bg-accent-soft/80 shadow-xs ring-1 ring-line-diecut/40"
                          : "border-line-subtle bg-surface-card hover:border-line-strong hover:bg-surface-elevated/60"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-ink-primary">{item.label}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 font-mono text-[9px] font-bold uppercase ${
                            active
                              ? "bg-accent text-accent-ink"
                              : "bg-surface-elevated text-ink-muted"
                          }`}
                        >
                          {item.badge}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">
                        {item.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Precision Sliders */}
            <div className="space-y-3 rounded-sticker border border-line-subtle bg-surface-elevated/45 p-3.5 text-xs">
              {mode !== "erase_transparent" && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink-secondary">Radio de reconstrucción</span>
                    <span className="font-mono text-[11px] font-bold tabular-nums text-ink-primary">
                      {inpaintRadius} px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={3}
                    max={25}
                    value={inpaintRadius}
                    onChange={(e) => setInpaintRadius(Number(e.target.value))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-card accent-accent"
                  />
                </div>
              )}

              {mode !== "erase_transparent" && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink-secondary">
                      Expansión extra de borde
                    </span>
                    <span className="font-mono text-[11px] font-bold tabular-nums text-ink-primary">
                      {maskDilate === 0 ? "0 px (Exacto)" : `+${maskDilate} px`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={8}
                    value={maskDilate}
                    onChange={(e) => setMaskDilate(Number(e.target.value))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-card accent-accent"
                  />
                </div>
              )}

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-ink-secondary">Suavizado de fusión</span>
                  <span className="font-mono text-[11px] font-bold tabular-nums text-ink-primary">
                    {maskFeather} px
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={6}
                  value={maskFeather}
                  onChange={(e) => setMaskFeather(Number(e.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-card accent-accent"
                />
              </div>

              {mode === "watermark_clean" && (
                <div className="space-y-1 border-t border-dashed border-line-subtle pt-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink-secondary">
                      Intensidad antimarca
                    </span>
                    <span className="font-mono text-[11px] font-bold tabular-nums text-accent">
                      {watermarkStrength}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={100}
                    value={watermarkStrength}
                    onChange={(e) => setWatermarkStrength(Number(e.target.value))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-card accent-accent"
                  />
                </div>
              )}

              <Button
                type="button"
                variant="primary"
                size="md"
                fullWidth
                disabled={!hasMaskStrokes || compareOriginal}
                loading={applyingInpaint}
                onClick={() => void handleRunInpaint()}
                leftIcon={<Wand2 className="h-4 w-4" />}
              >
                Borrar zona marcada
              </Button>
            </div>

            {/* 4. Auto Watermark Detection Assistant */}
            <div className="space-y-2.5 rounded-sticker border border-dashed border-line-diecut/75 bg-accent-soft/35 p-3.5 text-xs">
              <div className="flex items-center gap-2 font-extrabold text-ink-primary">
                <Scissors className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                <span>Detector Rápido de Marca de Agua</span>
              </div>

              <div className="grid grid-cols-3 gap-1.5 text-[11px] font-bold">
                {(
                  [
                    { id: "light", label: "Claras" },
                    { id: "dark", label: "Oscuras" },
                    { id: "both", label: "Ambas" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={wmTone === opt.id}
                    onClick={() => setWmTone(opt.id)}
                    className={`rounded-md border py-1.5 transition-all duration-fast ease-studio ${
                      wmTone === opt.id
                        ? "border-accent bg-accent text-accent-ink shadow-xs"
                        : "border-line-subtle bg-surface-card text-ink-secondary hover:border-line-strong hover:text-ink-primary"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-ink-secondary">Sensibilidad</span>
                  <span className="font-mono font-bold tabular-nums text-ink-primary">
                    {wmSensitivity}%
                  </span>
                </div>
                <input
                  type="range"
                  min={15}
                  max={90}
                  value={wmSensitivity}
                  onChange={(e) => setWmSensitivity(Number(e.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-card accent-accent"
                />
              </div>

              <Button
                type="button"
                variant="dieCut"
                size="sm"
                fullWidth
                loading={detectingWatermark}
                onClick={() => void handleDetectWatermark()}
                leftIcon={<Sparkles className="h-3.5 w-3.5 text-accent" />}
              >
                Detectar y marcar marca de agua
              </Button>
            </div>
          </div>
        </div>

        {/* Bottom Confirmation & History Bar */}
        <div className="flex flex-col gap-3 border-t border-dashed border-line-subtle pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasAppliedEdits}
              onClick={handleUndoAppliedPass}
              leftIcon={<Undo2 className="h-3.5 w-3.5" />}
            >
              Deshacer último borrado
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!hasAppliedEdits}
              onClick={handleRestoreInitial}
              leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
            >
              Restaurar original
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <Button type="button" variant="outline" size="md" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={!hasAppliedEdits}
              loading={savingToLab}
              onClick={() => void handleConfirmApply()}
              leftIcon={<Check className="h-4 w-4" />}
            >
              Aplicar al Laboratorio de Calidad
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
