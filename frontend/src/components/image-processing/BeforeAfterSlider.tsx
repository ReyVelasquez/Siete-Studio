import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Columns2,
  Eye,
  History,
  Image as ImageIcon,
  Layers,
  Loader2,
  MoveHorizontal,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

export type CanvasViewMode = "split" | "original" | "enhanced";

interface WhiteInkMaskState {
  dataUrl: string | null;
  coveragePercent: number | null;
  hasAlphaCutout: boolean;
  computing: boolean;
}

interface BeforeAfterSliderProps {
  originalUrl: string | null;
  enhancedUrl: string | null;
  processing: boolean;
  dpiLabel?: number;
  /** Controlled non-destructive view mode ("original" | "split" | "enhanced"). */
  viewMode?: CanvasViewMode;
  onViewModeChange?: (mode: CanvasViewMode) => void;
  /** True when the active design substrate is Transparente or DTF UV. */
  supportsWhiteInk?: boolean;
  /** Material name shown on the White Ink plate HUD. */
  materialLabel?: string;
  /** Controlled White Ink mask preview switch. */
  whiteInkPreview?: boolean;
  onWhiteInkPreviewChange?: (enabled: boolean) => void;
  /** Optional server-generated White Ink mask data URL. */
  serverWhiteInkMaskUrl?: string | null;
  /** Requested physical size (e.g. "Ø 5 cm" or "5x7 cm") shown on the cutting-mat HUD. */
  sizeDisplay?: string | null;
  /** Slot in the darkroom HUD for the Preflight DPI traffic-light pill. */
  preflightSlot?: React.ReactNode;
  /** Callback fired whenever the original artwork's natural pixel dimensions are measured. */
  onOriginalDimensions?: (dims: { width: number; height: number } | null) => void;
}

const MIN_ZOOM = 50;
const MAX_ZOOM = 400;
const WHITE_INK_MAX_PREVIEW_DIM = 1400;

export const BeforeAfterSlider: React.FC<BeforeAfterSliderProps> = ({
  originalUrl,
  enhancedUrl,
  processing,
  dpiLabel = 300,
  viewMode,
  onViewModeChange,
  supportsWhiteInk = false,
  materialLabel,
  whiteInkPreview = false,
  onWhiteInkPreviewChange,
  serverWhiteInkMaskUrl = null,
  sizeDisplay = null,
  preflightSlot,
  onOriginalDimensions,
}) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [internalMode, setInternalMode] = useState<CanvasViewMode>("split");
  const [splitPercent, setSplitPercent] = useState(50);
  const [whiteInkSplit, setWhiteInkSplit] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [viewportSize, setViewportSize] = useState({ width: 720, height: 500 });
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [whiteInkState, setWhiteInkState] = useState<WhiteInkMaskState>({
    dataUrl: null,
    coveragePercent: null,
    hasAlphaCutout: true,
    computing: false,
  });

  const activeMode = viewMode ?? internalMode;
  const setActiveMode = (next: CanvasViewMode) => {
    if (onViewModeChange) onViewModeChange(next);
    else setInternalMode(next);
  };

  const hasBoth = Boolean(originalUrl && enhancedUrl);
  const effectiveMode: CanvasViewMode =
    activeMode === "original"
      ? "original"
      : activeMode === "enhanced"
      ? enhancedUrl
        ? "enhanced"
        : "original"
      : hasBoth
      ? "split"
      : enhancedUrl
      ? "enhanced"
      : "original";

  const displaySingle =
    effectiveMode === "original" ? originalUrl : enhancedUrl || originalUrl;

  const isWhiteInkActive = Boolean(supportsWhiteInk && whiteInkPreview && displaySingle);
  const whiteInkSourceUrl =
    effectiveMode === "original" ? originalUrl : enhancedUrl || originalUrl;

  // Measure the original artwork's true pixel dimensions reliably for DPI Preflight
  useEffect(() => {
    if (!originalUrl) {
      onOriginalDimensions?.(null);
      return;
    }
    let cancelled = false;
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = () => {
      if (cancelled) return;
      if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
        onOriginalDimensions?.({ width: probe.naturalWidth, height: probe.naturalHeight });
      }
    };
    probe.onerror = () => {
      if (!cancelled) onOriginalDimensions?.(null);
    };
    probe.src = originalUrl;
    return () => {
      cancelled = true;
    };
  }, [originalUrl, onOriginalDimensions]);

  // Measure scroll viewport so 100% fits cleanly and >100% expands smoothly
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

  // Support Illustrator-style Ctrl/Cmd + mouse wheel zoom on the darkroom viewport
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !displaySingle) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 25 : -25;
      setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [displaySingle]);

  useEffect(() => {
    setZoom(100);
    if (!displaySingle) {
      setNaturalSize(null);
    }
  }, [originalUrl, displaySingle]);

  // Reset white-ink split helper when turning white ink off
  useEffect(() => {
    if (!isWhiteInkActive) {
      setWhiteInkSplit(false);
    }
  }, [isWhiteInkActive]);

  // Generate pixel-accurate Spot White Ink (Cama Blanca) alpha mask on offscreen canvas
  useEffect(() => {
    if (!isWhiteInkActive || !whiteInkSourceUrl) {
      setWhiteInkState({
        dataUrl: null,
        coveragePercent: null,
        hasAlphaCutout: true,
        computing: false,
      });
      return;
    }

    if (serverWhiteInkMaskUrl && effectiveMode !== "original") {
      setWhiteInkState({
        dataUrl: serverWhiteInkMaskUrl,
        coveragePercent: null,
        hasAlphaCutout: true,
        computing: false,
      });
      return;
    }

    let cancelled = false;
    setWhiteInkState((prev) => ({ ...prev, computing: true }));

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const natW = img.naturalWidth || 1;
        const natH = img.naturalHeight || 1;
        const scale = Math.min(1, WHITE_INK_MAX_PREVIEW_DIM / Math.max(natW, natH));
        const w = Math.max(1, Math.round(natW * scale));
        const h = Math.max(1, Math.round(natH * scale));

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas 2D no disponible");

        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;

        let alphaTransparentCount = 0;
        let whiteCoverageSum = 0;
        const totalPixels = w * h;

        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha < 250) {
            alphaTransparentCount += 1;
          }
          if (alpha > 12) {
            // Pure calibrated white ink plate preserving smooth anti-aliased edges
            data[i] = 250;
            data[i + 1] = 252;
            data[i + 2] = 255;
            data[i + 3] = alpha;
            whiteCoverageSum += alpha / 255;
          } else {
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = 0;
          }
        }

        ctx.putImageData(imageData, 0, 0);
        const maskUrl = canvas.toDataURL("image/png");
        const coverage = Math.round((whiteCoverageSum / Math.max(1, totalPixels)) * 1000) / 10;
        const hasAlphaCutout = alphaTransparentCount / Math.max(1, totalPixels) > 0.004;

        if (!cancelled) {
          setWhiteInkState({
            dataUrl: maskUrl,
            coveragePercent: coverage,
            hasAlphaCutout,
            computing: false,
          });
        }
      } catch {
        if (!cancelled) {
          setWhiteInkState({
            dataUrl: null,
            coveragePercent: null,
            hasAlphaCutout: true,
            computing: false,
          });
        }
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        setWhiteInkState({
          dataUrl: null,
          coveragePercent: null,
          hasAlphaCutout: true,
          computing: false,
        });
      }
    };
    img.src = whiteInkSourceUrl;

    return () => {
      cancelled = true;
    };
  }, [isWhiteInkActive, whiteInkSourceUrl, serverWhiteInkMaskUrl, effectiveMode]);

  const stageDims = useMemo(() => {
    const natW = naturalSize?.width || 600;
    const natH = naturalSize?.height || 600;
    const availW = Math.max(200, viewportSize.width - 40);
    const availH = Math.max(200, viewportSize.height - 40);
    const fitScale = Math.min(availW / natW, availH / natH);
    const factor = zoom / 100;
    return {
      width: Math.max(72, Math.round(natW * fitScale * factor)),
      height: Math.max(72, Math.round(natH * fitScale * factor)),
    };
  }, [naturalSize, viewportSize, zoom]);

  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setNaturalSize((prev) =>
        prev && prev.width === img.naturalWidth && prev.height === img.naturalHeight
          ? prev
          : { width: img.naturalWidth, height: img.naturalHeight }
      );
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-sticker border border-darkroom-line bg-darkroom-surface text-darkroom-ink shadow-elevated">
      {/* Darkroom HUD Control Strip */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-darkroom-line/85 bg-darkroom-mat/95 px-3 py-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {preflightSlot ? (
            preflightSlot
          ) : (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-sborg-emerald" aria-hidden="true" />
              <span className="font-mono text-[11px] font-bold tracking-tight text-darkroom-ink">
                MESA DE PREPRENSA · {dpiLabel} DPI
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* White Ink (Cama Blanca) Switch — only shown for Transparente / DTF UV */}
          {supportsWhiteInk && (
            <button
              type="button"
              role="switch"
              aria-checked={whiteInkPreview}
              disabled={!displaySingle}
              onClick={() => onWhiteInkPreviewChange?.(!whiteInkPreview)}
              className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] font-bold transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 ${
                whiteInkPreview
                  ? "border-sborg-emerald bg-darkroom-elevated text-sborg-white shadow-xs"
                  : "border-darkroom-line bg-darkroom-surface text-darkroom-muted hover:border-sborg-emerald/60 hover:text-darkroom-ink"
              }`}
              title={`Previsualizar máscara de tinta blanca para ${materialLabel || "sustrato transparente"}`}
            >
              <span
                aria-hidden="true"
                className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors duration-fast ease-studio ${
                  whiteInkPreview
                    ? "border-sborg-emerald bg-sborg-emerald"
                    : "border-darkroom-line bg-darkroom-mat"
                }`}
              >
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full transition-transform duration-fast ease-studio ${
                    whiteInkPreview
                      ? "translate-x-3.5 bg-sborg-midnight"
                      : "translate-x-0.5 bg-darkroom-muted"
                  }`}
                />
              </span>
              <Layers className="h-3.5 w-3.5 text-sborg-white" aria-hidden="true" />
              <span>Cama Blanca</span>
              {whiteInkPreview && whiteInkState.coveragePercent !== null && (
                <span className="rounded-xs bg-sborg-white/15 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-sborg-white">
                  {whiteInkState.coveragePercent}%
                </span>
              )}
            </button>
          )}

          {/* Non-Destructive Artwork View Mode Switcher */}
          {displaySingle && (
            <div
              role="group"
              aria-label="Modo de visualización no destructivo"
              className="inline-flex rounded-md border border-darkroom-line bg-darkroom-mat p-0.5 text-[11px] font-bold"
            >
              <button
                type="button"
                aria-pressed={effectiveMode === "original"}
                onClick={() => setActiveMode("original")}
                className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  effectiveMode === "original"
                    ? "bg-sborg-emerald text-sborg-midnight shadow-xs"
                    : "text-darkroom-muted hover:text-darkroom-ink"
                }`}
              >
                <History className="h-3 w-3" aria-hidden="true" />
                <span>Original</span>
              </button>
              <button
                type="button"
                disabled={!hasBoth}
                aria-pressed={effectiveMode === "split"}
                onClick={() => setActiveMode("split")}
                className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35 ${
                  effectiveMode === "split"
                    ? "bg-sborg-emerald text-sborg-midnight shadow-xs"
                    : "text-darkroom-muted hover:text-darkroom-ink"
                }`}
              >
                <Columns2 className="h-3 w-3" aria-hidden="true" />
                <span>Comparar</span>
              </button>
              <button
                type="button"
                disabled={!enhancedUrl}
                aria-pressed={effectiveMode === "enhanced"}
                onClick={() => setActiveMode("enhanced")}
                className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 transition-all duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35 ${
                  effectiveMode === "enhanced"
                    ? "bg-sborg-emerald text-sborg-midnight shadow-xs"
                    : "text-darkroom-muted hover:text-darkroom-ink"
                }`}
              >
                <Eye className="h-3 w-3" aria-hidden="true" />
                <span>Mejorado</span>
              </button>
            </div>
          )}

          {/* Precision Zoom Controls */}
          {displaySingle && (
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
                className="rounded-sm p-1 text-darkroom-muted transition-colors duration-fast ease-studio hover:bg-darkroom-elevated hover:text-darkroom-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
              >
                <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(100)}
                title="Restablecer zoom al 100%"
                className="min-w-[42px] rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-darkroom-ink transition-colors duration-fast ease-studio hover:bg-darkroom-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {zoom}%
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 25))}
                disabled={zoom >= MAX_ZOOM}
                aria-label="Acercar zoom"
                title="Acercar zoom (Ctrl + Rueda)"
                className="rounded-sm p-1 text-darkroom-muted transition-colors duration-fast ease-studio hover:bg-darkroom-elevated hover:text-darkroom-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
              >
                <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Calibrated Cutting-Mat Proofing Stage */}
      <div className="bg-cutting-mat relative flex min-h-0 flex-1 overflow-hidden">
        {/* Precision Print-Shop Corner Registration Crop Marks */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-3 z-20 h-3.5 w-3.5 border-l-[1.5px] border-t-[1.5px] border-sborg-emerald/75"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-3 z-20 h-3.5 w-3.5 border-r-[1.5px] border-t-[1.5px] border-sborg-emerald/75"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-3 left-3 z-20 h-3.5 w-3.5 border-b-[1.5px] border-l-[1.5px] border-sborg-emerald/75"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-3 right-3 z-20 h-3.5 w-3.5 border-b-[1.5px] border-r-[1.5px] border-sborg-emerald/75"
        />

        {/* Pinned Top-Corner Status Badges */}
        {displaySingle && isWhiteInkActive && (
          <div className="pointer-events-none absolute left-4 top-3.5 z-20 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sborg-white/40 bg-darkroom-mat/90 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase text-sborg-white backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full bg-sborg-white" aria-hidden="true" />
              Máscara Cama Blanca (Spot White) · {materialLabel}
            </span>
          </div>
        )}

        {displaySingle && !isWhiteInkActive && effectiveMode === "split" && hasBoth && (
          <>
            <span className="pointer-events-none absolute left-4 top-3.5 z-20 rounded-full border border-dashed border-darkroom-line bg-darkroom-mat/90 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase text-darkroom-ink backdrop-blur-sm">
              Arte Original
            </span>
            <span className="pointer-events-none absolute right-4 top-3.5 z-20 rounded-full border border-sborg-emerald bg-sborg-emerald px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tabular-nums text-sborg-midnight shadow-xs">
              Mejorado · {dpiLabel} DPI · {zoom}%
            </span>
          </>
        )}

        {displaySingle && !isWhiteInkActive && effectiveMode !== "split" && (
          <span
            className={`pointer-events-none absolute right-4 top-3.5 z-20 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tabular-nums ${
              effectiveMode === "original"
                ? "border-dashed border-darkroom-line bg-darkroom-mat/90 text-darkroom-ink"
                : "border-sborg-emerald bg-sborg-emerald text-sborg-midnight"
            }`}
          >
            {effectiveMode === "original"
              ? `Arte Original (Sin alterar) · ${zoom}%`
              : `Arte Mejorado · ${dpiLabel} DPI · ${zoom}%`}
          </span>
        )}

        {/* Bottom-Left Technical Cutting-Mat Coordinate / Spec Readout */}
        {displaySingle && (
          <div className="pointer-events-none absolute bottom-3.5 left-4 z-20 hidden items-center gap-2 rounded-sm border border-darkroom-line/80 bg-darkroom-mat/85 px-2.5 py-1 font-mono text-[10px] tabular-nums text-darkroom-muted backdrop-blur-sm sm:inline-flex">
            {sizeDisplay && <span className="font-bold text-sborg-emerald">{sizeDisplay}</span>}
            {sizeDisplay && naturalSize && <span aria-hidden="true">·</span>}
            {naturalSize && (
              <span>
                {naturalSize.width}×{naturalSize.height} px
              </span>
            )}
            <span aria-hidden="true">·</span>
            <span>{dpiLabel} DPI</span>
          </div>
        )}

        {/* Scrollable Zoom Viewport */}
        <div
          ref={viewportRef}
          className="relative flex h-full min-h-[340px] w-full flex-1 overflow-auto"
        >
          <div className="flex min-h-full min-w-full flex-1 p-4">
            {!displaySingle ? (
              <div className="m-auto flex flex-col items-center justify-center px-4 text-center">
                <span
                  aria-hidden="true"
                  className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-sborg-emerald/60 bg-darkroom-surface text-sborg-emerald"
                >
                  <ImageIcon className="h-6 w-6" />
                </span>
                <p className="mt-3 font-display text-sm font-extrabold text-darkroom-ink">
                  Mesa de corte lista para preprensa
                </p>
                <p className="mt-1 max-w-xs text-xs leading-relaxed text-darkroom-muted">
                  Selecciona un pedido en la barra superior o sube un diseño PNG, JPG o WEBP para
                  calibrar resolución, CMYK y cama blanca.
                </p>
              </div>
            ) : isWhiteInkActive ? (
              <div
                style={
                  zoom === 100
                    ? undefined
                    : {
                        width: `${stageDims.width}px`,
                        height: `${stageDims.height}px`,
                      }
                }
                className={`bg-darkroom-checker relative m-auto select-none overflow-hidden rounded-sm border border-dashed border-sborg-white/35 shadow-elevated ${
                  zoom === 100 ? "h-full min-h-[300px] w-full flex-1" : "shrink-0"
                }`}
              >
                {whiteInkSplit && whiteInkState.dataUrl ? (
                  <>
                    {/* Right side: Pure Spot White Ink Mask */}
                    <img
                      src={whiteInkState.dataUrl}
                      alt="Máscara de tinta blanca (Cama Blanca)"
                      draggable={false}
                      onLoad={handleImgLoad}
                      className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
                    />
                    {/* Left side: Artwork */}
                    <img
                      src={whiteInkSourceUrl!}
                      alt="Arte base para cama blanca"
                      draggable={false}
                      style={{ clipPath: `inset(0 ${100 - splitPercent}% 0 0)` }}
                      className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
                    />
                    <div
                      aria-hidden="true"
                      style={{ left: `${splitPercent}%` }}
                      className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 cursor-ew-resize bg-sborg-emerald shadow-elevated"
                    >
                      <div className="absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-darkroom-mat bg-sborg-emerald text-sborg-midnight shadow-elevated">
                        <MoveHorizontal className="h-3.5 w-3.5" />
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={splitPercent}
                      onChange={(e) => setSplitPercent(Number(e.target.value))}
                      aria-label="Comparar arte y máscara de cama blanca"
                      className="absolute inset-0 z-30 h-full w-full cursor-ew-resize opacity-0 focus-visible:outline-none"
                    />
                  </>
                ) : (
                  <img
                    src={whiteInkState.dataUrl || whiteInkSourceUrl!}
                    alt="Previsualización de máscara de tinta blanca (Cama Blanca)"
                    draggable={false}
                    onLoad={handleImgLoad}
                    className={`pointer-events-none absolute inset-0 h-full w-full select-none object-contain transition-opacity duration-fast ${
                      whiteInkState.computing ? "opacity-50" : "opacity-100"
                    }`}
                  />
                )}
              </div>
            ) : effectiveMode === "split" && hasBoth ? (
              <div
                style={
                  zoom === 100
                    ? undefined
                    : {
                        width: `${stageDims.width}px`,
                        height: `${stageDims.height}px`,
                      }
                }
                className={`bg-darkroom-checker relative m-auto select-none overflow-hidden rounded-sm border border-dashed border-sborg-emerald/45 shadow-elevated ${
                  zoom === 100 ? "h-full min-h-[300px] w-full flex-1" : "shrink-0"
                }`}
              >
                {/* Base layer ("Después"): Enhanced result occupying exact same inset-0 box */}
                <img
                  src={enhancedUrl!}
                  alt="Arte mejorado"
                  draggable={false}
                  onLoad={handleImgLoad}
                  className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
                />

                {/* Clipped top layer ("Antes"): Original untouched occupying exact same inset-0 box */}
                <img
                  src={originalUrl!}
                  alt="Arte original"
                  draggable={false}
                  style={{ clipPath: `inset(0 ${100 - splitPercent}% 0 0)` }}
                  className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
                />

                {/* Vertical split divider line + draggable center handle */}
                <div
                  aria-hidden="true"
                  style={{ left: `${splitPercent}%` }}
                  className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 cursor-ew-resize bg-sborg-emerald shadow-elevated"
                >
                  <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-sborg-emerald" />
                  <div className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-darkroom-mat bg-sborg-emerald text-sborg-midnight shadow-elevated">
                    <MoveHorizontal className="h-4 w-4" />
                  </div>
                  <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-sborg-emerald" />
                </div>

                {/* Full-surface interactive range slider */}
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={splitPercent}
                  onChange={(e) => setSplitPercent(Number(e.target.value))}
                  aria-label="Comparador Arte Original y Arte Mejorado"
                  className="absolute inset-0 z-30 h-full w-full cursor-ew-resize opacity-0 focus-visible:outline-none"
                />
              </div>
            ) : (
              <div
                style={
                  zoom === 100
                    ? undefined
                    : {
                        width: `${stageDims.width}px`,
                        height: `${stageDims.height}px`,
                      }
                }
                className={`bg-darkroom-checker relative m-auto select-none overflow-hidden rounded-sm border border-dashed border-darkroom-line shadow-elevated ${
                  zoom === 100 ? "h-full min-h-[300px] w-full flex-1" : "shrink-0"
                }`}
              >
                <img
                  src={displaySingle}
                  alt={effectiveMode === "original" ? "Arte original" : "Arte mejorado"}
                  draggable={false}
                  onLoad={handleImgLoad}
                  className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
                />
              </div>
            )}
          </div>
        </div>

        {/* Non-blocking processing badge */}
        {processing && (
          <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-darkroom-mat/50 backdrop-blur-[1.5px]">
            <div className="flex items-center gap-2 rounded-full border border-dashed border-sborg-emerald bg-darkroom-surface px-4 py-2 text-xs font-bold text-darkroom-ink shadow-elevated">
              <Loader2 className="h-4 w-4 animate-spin text-sborg-emerald" aria-hidden="true" />
              <span>Procesando OpenCV + CMYK...</span>
            </div>
          </div>
        )}
      </div>

      {/* White Ink Opaque Warning Banner (when artwork lacks alpha channel) */}
      {isWhiteInkActive && !whiteInkState.computing && !whiteInkState.hasAlphaCutout && (
        <div
          role="status"
          className="flex items-start gap-2.5 border-t border-darkroom-line/80 bg-preflight-warn-bg/95 px-3.5 py-2 text-[11px] text-preflight-warn-ink"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>
            <strong>Sin canal alfa detectado:</strong> la cama blanca cubriría el 100% del
            rectángulo. Activa <strong>Quitar Fondo (PNG Transparente)</strong> para limitar la
            tinta blanca únicamente a la silueta del diseño.
          </p>
        </div>
      )}

      {/* Darkroom Bottom Inspection Strip */}
      {displaySingle && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-darkroom-line/85 bg-darkroom-mat/95 px-3.5 py-2 text-[11px]">
          {isWhiteInkActive ? (
            <>
              <span className="text-darkroom-muted">
                Placa blanca para{" "}
                <strong className="text-darkroom-ink">{materialLabel || "Transparente"}</strong>
                {whiteInkState.coveragePercent !== null && (
                  <>
                    {" "}
                    · Cobertura:{" "}
                    <strong className="font-mono tabular-nums text-sborg-emerald">
                      {whiteInkState.coveragePercent}%
                    </strong>
                  </>
                )}
              </span>
              <div className="inline-flex items-center gap-1.5 font-mono font-bold">
                <button
                  type="button"
                  aria-pressed={!whiteInkSplit}
                  onClick={() => setWhiteInkSplit(false)}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] transition-colors duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    !whiteInkSplit
                      ? "border-sborg-emerald bg-sborg-emerald text-sborg-midnight"
                      : "border-darkroom-line bg-darkroom-surface text-darkroom-muted hover:text-darkroom-ink"
                  }`}
                >
                  Solo Placa Blanca
                </button>
                <button
                  type="button"
                  aria-pressed={whiteInkSplit}
                  onClick={() => setWhiteInkSplit(true)}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] transition-colors duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    whiteInkSplit
                      ? "border-sborg-emerald bg-sborg-emerald text-sborg-midnight"
                      : "border-darkroom-line bg-darkroom-surface text-darkroom-muted hover:text-darkroom-ink"
                  }`}
                >
                  Comparar Arte / Blanca
                </button>
              </div>
            </>
          ) : effectiveMode === "split" && hasBoth ? (
            <>
              <span className="text-darkroom-muted">
                Divisor ({splitPercent}%) ·{" "}
                <strong className="text-darkroom-ink">Ctrl + Rueda</strong> para zoom
              </span>
              <div className="inline-flex items-center gap-1.5 font-mono font-bold">
                <button
                  type="button"
                  onClick={() => setSplitPercent(100)}
                  aria-pressed={splitPercent === 100}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] transition-colors duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    splitPercent === 100
                      ? "border-sborg-emerald bg-sborg-emerald text-sborg-midnight"
                      : "border-darkroom-line bg-darkroom-surface text-darkroom-muted hover:text-darkroom-ink"
                  }`}
                >
                  Original
                </button>
                <button
                  type="button"
                  onClick={() => setSplitPercent(50)}
                  aria-pressed={splitPercent === 50}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] transition-colors duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    splitPercent === 50
                      ? "border-sborg-emerald bg-sborg-emerald text-sborg-midnight"
                      : "border-darkroom-line bg-darkroom-surface text-darkroom-muted hover:text-darkroom-ink"
                  }`}
                >
                  50 / 50
                </button>
                <button
                  type="button"
                  onClick={() => setSplitPercent(0)}
                  aria-pressed={splitPercent === 0}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] transition-colors duration-fast ease-studio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    splitPercent === 0
                      ? "border-sborg-emerald bg-sborg-emerald text-sborg-midnight"
                      : "border-darkroom-line bg-darkroom-surface text-darkroom-muted hover:text-darkroom-ink"
                  }`}
                >
                  Mejorado
                </button>
              </div>
            </>
          ) : (
            <span className="text-darkroom-muted">
              <strong className="text-darkroom-ink">Ctrl + Rueda</strong> para zoom de precisión ·
              Modo no destructivo activo
            </span>
          )}
        </div>
      )}
    </div>
  );
};
