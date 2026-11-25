"""
Phase 2 - Module 1 (Active): Image Quality Enhancement, AI/OpenCV Background Removal (PNG) & CMYK Prepress.

Powered by OpenCV, NumPy, Pillow, and optional `rembg` (`u2netp` ONNX model):
1. Optional background removal (`ai_rembg` lazy-cached `u2netp` ONNX model with automatic
   OpenCV `smart_subject` fallback, border-connected CIELAB matting, or GrabCut segmentation)
   converting artwork into clean transparent PNG ready for silhouette die-cutting.
2. Preserves sticker transparency (RGBA alpha channel with premultiplied Lanczos-4 upscaling).
3. Resolution upscaling (1x–4x, safely capped at 4096 px) + embedded print DPI metadata (150/300/600).
4. Edge-preserving denoising, Unsharp Mask sharpening, and optional LAB CLAHE auto-contrast.
5. Photographic Brightness, Contrast, Saturation (HSV), and Gamma controls.
6. Full RGB <-> CMYK color-space calibration (C, M, Y, K channel adjustments + Total Ink Coverage
   TAC limiter & telemetry) with transparent PNG preview or true 4-channel CMYK TIFF/JPEG export.
"""

from __future__ import annotations

import asyncio
import io
import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

from app.modules.image_processing.base import (
    BaseImageProcessor,
    CmykStats,
    EnhancementOptions,
    ImageAsset,
    ProcessingResult,
    check_phase2_dependencies,
)
from app.schemas.order import SizeMode, parse_non_circular_dimensions

logger = logging.getLogger(__name__)

MAX_OUTPUT_DIMENSION_PX = 4096
REMBG_DEFAULT_MODEL = "u2netp"
_REMBG_SESSION_CACHE: Dict[str, Any] = {}
_REMBG_SESSION_LOCK = threading.Lock()


@dataclass(frozen=True)
class EnhancePayload:
    asset: ImageAsset
    options: EnhancementOptions
    item: Optional[Any] = None


def _get_item_attr(item: Any, key: str) -> Any:
    if item is None:
        return None
    if isinstance(item, dict):
        return item.get(key)
    return getattr(item, key, None)


def resolve_physical_size_cm(
    item: Any,
    artwork_w_px: float | int,
    artwork_h_px: float | int,
) -> Optional[Tuple[float, float]]:
    """
    Resolve real physical dimensions `(width_cm, height_cm)` for an `order_item` (or dict/schema)
    using the pixel dimensions `(artwork_w_px, artwork_h_px)` of the design or cut contour:
    - Circular (`diameter_cm`): returns `(diameter_cm, diameter_cm)`.
    - `size_mode == "height_only"` (only `Alto` defined):
      calculates `width_cm = height_cm * (artwork_w_px / artwork_h_px)`.
    - `size_mode == "width_only"` (only `Ancho` defined):
      calculates `height_cm = width_cm * (artwork_h_px / artwork_w_px)`.
    - `size_mode == "both"` (`Alto x Ancho` defined):
      returns `(width_cm, height_cm)`.
    """
    if item is None:
        return None

    diameter_raw = _get_item_attr(item, "diameter_cm")
    if diameter_raw is not None:
        try:
            d = float(diameter_raw)
        except (TypeError, ValueError):
            d = 0.0
        if d > 0:
            d_rounded = round(d, 2)
            return (d_rounded, d_rounded)

    dimensions_raw = _get_item_attr(item, "dimensions")
    size_mode_raw = _get_item_attr(item, "size_mode")
    height_raw = _get_item_attr(item, "height_cm")
    if height_raw is None:
        height_raw = _get_item_attr(item, "target_height_cm")
    width_raw = _get_item_attr(item, "width_cm")
    if width_raw is None:
        width_raw = _get_item_attr(item, "target_width_cm")

    mode, h_cm, w_cm = parse_non_circular_dimensions(
        dimensions_raw,
        size_mode_raw,
        float(height_raw) if height_raw is not None else None,
        float(width_raw) if width_raw is not None else None,
    )

    safe_w_px = max(1.0, float(artwork_w_px if artwork_w_px and float(artwork_w_px) > 0 else 1.0))
    safe_h_px = max(1.0, float(artwork_h_px if artwork_h_px and float(artwork_h_px) > 0 else 1.0))

    if mode == SizeMode.HEIGHT_ONLY and h_cm is not None and h_cm > 0:
        calc_w_cm = max(0.1, float(h_cm) * (safe_w_px / safe_h_px))
        return (round(calc_w_cm, 2), round(float(h_cm), 2))

    if mode == SizeMode.WIDTH_ONLY and w_cm is not None and w_cm > 0:
        calc_h_cm = max(0.1, float(w_cm) * (safe_h_px / safe_w_px))
        return (round(float(w_cm), 2), round(calc_h_cm, 2))

    if mode == SizeMode.BOTH and h_cm is not None and w_cm is not None and h_cm > 0 and w_cm > 0:
        return (round(float(w_cm), 2), round(float(h_cm), 2))

    return None


def compute_effective_dpi_for_item(
    item: Any,
    width_px: int | float,
    height_px: int | float,
) -> Tuple[Optional[float], Optional[str]]:
    """
    Calculate real effective print DPI and semaphore status (`ok` | `warning` | `critical`)
    for `item` at pixel resolution `(width_px, height_px)` using `resolve_physical_size_cm`.
    """
    if item is None or width_px <= 0 or height_px <= 0:
        return None, None

    size_cm = resolve_physical_size_cm(item, width_px, height_px)
    if size_cm is None:
        return None, None

    width_cm, height_cm = size_cm
    width_in = width_cm / 2.54
    height_in = height_cm / 2.54

    dpi_direct = min(float(width_px) / width_in, float(height_px) / height_in)
    dpi_rotated = min(float(width_px) / height_in, float(height_px) / width_in)
    effective_dpi = round(max(dpi_direct, dpi_rotated), 1)

    if effective_dpi >= 300.0:
        status = "ok"
    elif effective_dpi >= 150.0:
        status = "warning"
    else:
        status = "critical"

    return effective_dpi, status


def get_rembg_session(model_name: str = REMBG_DEFAULT_MODEL) -> Any:
    """
    Lazily import `rembg` and return a cached ONNX session for `model_name` (default: `u2netp`).

    Thread-safe double-checked locking ensures the ONNX runtime and model weights are only
    loaded into RAM on the first `ai_rembg` request rather than at FastAPI startup.
    Raises `ImportError` if `rembg` or `onnxruntime` is not installed in the Python environment.
    """
    cached = _REMBG_SESSION_CACHE.get(model_name)
    if cached is not None:
        return cached

    with _REMBG_SESSION_LOCK:
        cached = _REMBG_SESSION_CACHE.get(model_name)
        if cached is not None:
            return cached

        # Lazy imports inside function so FastAPI startup uses 0 MB of ONNX/rembg RAM
        import onnxruntime  # noqa: F401
        from rembg import new_session

        logger.info("Inicializando sesión perezosa de rembg con el modelo liviano '%s'...", model_name)
        session = new_session(model_name)
        _REMBG_SESSION_CACHE[model_name] = session
        return session


def clear_rembg_session_cache() -> None:
    """Clear cached `rembg` ONNX sessions (used in unit tests or explicit memory cleanup)."""
    with _REMBG_SESSION_LOCK:
        _REMBG_SESSION_CACHE.clear()


def _extract_border_bg_clusters(lab, alpha, *, max_k: int = 4):
    """
    Sample a 4px border frame around all 4 edges of the image and cluster opaque border pixels
    in CIELAB to model solid, shaded, gradient, or multi-tone backdrops accurately.
    Returns `(centers_lab_list, border_spread_p85)`.
    """
    import cv2
    import numpy as np

    h, w = lab.shape[:2]
    b = max(2, min(6, min(h, w) // 40))

    border_mask = np.zeros((h, w), dtype=bool)
    border_mask[:b, :] = True
    border_mask[-b:, :] = True
    border_mask[:, :b] = True
    border_mask[:, -b:] = True
    border_mask &= alpha >= 20

    pts = lab[border_mask]
    if len(pts) == 0:
        return [], 0.0

    med = np.median(pts, axis=0).astype(np.float32)
    dists = np.linalg.norm(pts - med[None, :], axis=1)
    spread = float(np.percentile(dists, 85))

    if len(pts) < 24 or spread < 10.0:
        return [med], spread

    step = max(1, len(pts) // 3000)
    sample = pts[::step].astype(np.float32)
    q = (sample // 14).astype(np.int32)
    unique_bins = len(np.unique(q[:, 0] * 65536 + q[:, 1] * 256 + q[:, 2]))
    k = max(1, min(max_k, unique_bins, len(sample)))
    if k == 1:
        return [med], spread

    cv2.setRNGSeed(42)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, _ = cv2.kmeans(sample, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    labels_flat = labels.ravel()
    total = float(len(labels_flat))

    clusters = []
    for cid in range(k):
        sel = labels_flat == cid
        cnt = int(np.count_nonzero(sel))
        if cnt / total >= 0.08:
            clusters.append((cnt / total, np.median(sample[sel], axis=0).astype(np.float32)))
    clusters.sort(key=lambda item: item[0], reverse=True)
    return [c[1] for c in clusters] or [med], spread


def _keep_main_design_components(fg_bin):
    """
    Isolate the main sticker design by keeping the dominant central component(s) and
    companion design elements while stripping tiny isolated dust or stray corner strips.
    """
    import cv2
    import numpy as np

    h, w = fg_bin.shape[:2]
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(fg_bin, connectivity=8)
    if num_labels <= 2:
        return fg_bin

    cx_img = w / 2.0
    cy_img = h / 2.0
    max_diag = max(1.0, float(np.hypot(cx_img, cy_img)))

    scored = []
    for cid in range(1, num_labels):
        area = int(stats[cid, cv2.CC_STAT_AREA])
        if area < 16:
            continue
        x0 = int(stats[cid, cv2.CC_STAT_LEFT])
        y0 = int(stats[cid, cv2.CC_STAT_TOP])
        cw = int(stats[cid, cv2.CC_STAT_WIDTH])
        ch = int(stats[cid, cv2.CC_STAT_HEIGHT])
        touches_border = x0 <= 1 or y0 <= 1 or (x0 + cw) >= (w - 1) or (y0 + ch) >= (h - 1)
        dist_center = float(np.hypot(centroids[cid][0] - cx_img, centroids[cid][1] - cy_img)) / max_diag
        # Favor large, centered main design; penalize small edge-clinging backdrop chunks
        center_weight = max(0.25, 1.35 - dist_center)
        border_penalty = 0.45 if (touches_border and area < (h * w * 0.15)) else 1.0
        scored.append((area * center_weight * border_penalty, area, cid, touches_border))

    if not scored:
        return fg_bin

    scored.sort(key=lambda item: item[0], reverse=True)
    main_area = scored[0][1]
    keep_ids = {scored[0][2]}

    for _, area, cid, touches_border in scored[1:]:
        # Preserve substantial companion elements (e.g. separate lettering/stars around logo)
        # while dropping stray background scraps clinging to the outer frame
        if not touches_border and area >= max(24, int(main_area * 0.015)):
            keep_ids.add(cid)
        elif touches_border and area >= int(main_area * 0.25):
            keep_ids.add(cid)

    return np.where(np.isin(labels, list(keep_ids)), 255, 0).astype(np.uint8)


def _decontaminate_edge_rgb(rgb, new_alpha):
    """
    Eliminate white/colored background halos along semi-transparent sticker edges by pulling
    pure interior RGB color from the nearest fully opaque pixel (Photoshop-style Decontaminate).
    Never alters interior opaque pixels (`alpha >= 245`).
    """
    import cv2
    import numpy as np

    solid_core = new_alpha >= 245
    # Erode solid core by 1px so even outermost opaque anti-aliased fringe gets clean ink color
    k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    eroded_core = cv2.erode(solid_core.astype(np.uint8) * 255, k3, iterations=1) > 0
    if int(np.count_nonzero(eroded_core)) < 24:
        eroded_core = solid_core
    if int(np.count_nonzero(eroded_core)) < 16:
        return rgb

    fringe = (new_alpha > 0) & (~eroded_core)
    if not np.any(fringe):
        return rgb

    inv_core = np.where(eroded_core, 0, 1).astype(np.uint8)
    _, nearest_labels = cv2.distanceTransformWithLabels(
        inv_core, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL
    )
    core_ys, core_xs = np.where(eroded_core)
    fr_ys, fr_xs = np.where(fringe)
    lbl_idx = np.clip(nearest_labels[fr_ys, fr_xs] - 1, 0, len(core_ys) - 1)

    out_rgb = rgb.copy()
    # Semi-transparent edge pixels (alpha < 220) carry blended background color in straight-alpha
    # cutouts; replace them 100% with clean interior ink so ZERO white/gray fringe remains.
    # For nearly opaque rim pixels (220..255), taper gently to preserve fine 1px outlines.
    a_u8 = new_alpha[fr_ys, fr_xs].astype(np.float32)
    decontam_weight = np.where(
        a_u8 < 220.0,
        1.0,
        np.clip(1.0 - ((a_u8 - 220.0) / 35.0) * 0.55, 0.45, 1.0),
    )[:, None]
    clean_edge = rgb[core_ys[lbl_idx], core_xs[lbl_idx]].astype(np.float32)
    orig_edge = rgb[fr_ys, fr_xs].astype(np.float32)
    out_rgb[fr_ys, fr_xs] = np.rint(
        orig_edge * (1.0 - decontam_weight) + clean_edge * decontam_weight
    ).clip(0, 255).astype(np.uint8)
    return out_rgb


def _remove_background_with_rembg(
    rgb,
    alpha,
    *,
    feather: int = 1,
    model_name: str = REMBG_DEFAULT_MODEL,
):
    """
    Remove image background using `rembg` with the lightweight cached `u2netp` ONNX model.

    Preserves any pre-existing alpha transparency, applies optional edge feathering,
    and runs RGB edge decontamination to eliminate white/colored halos.
    """
    import cv2
    import numpy as np
    from PIL import Image
    from rembg import remove as rembg_remove

    session = get_rembg_session(model_name)
    pil_input = Image.fromarray(rgb, mode="RGB")
    raw_out = rembg_remove(pil_input, session=session)

    if isinstance(raw_out, Image.Image):
        ai_rgba = np.array(raw_out.convert("RGBA"), dtype=np.uint8)
    elif isinstance(raw_out, (bytes, bytearray)):
        ai_rgba = np.array(Image.open(io.BytesIO(raw_out)).convert("RGBA"), dtype=np.uint8)
    else:
        ai_rgba = np.asarray(raw_out, dtype=np.uint8)
        if ai_rgba.ndim != 3 or ai_rgba.shape[2] < 4:
            raise RuntimeError("El modelo rembg devolvió un tensor sin canal alfa RGBA válido.")

    if ai_rgba.shape[:2] != alpha.shape[:2]:
        ai_alpha = cv2.resize(
            ai_rgba[:, :, 3],
            (alpha.shape[1], alpha.shape[0]),
            interpolation=cv2.INTER_LINEAR,
        )
    else:
        ai_alpha = ai_rgba[:, :, 3]

    new_alpha = np.minimum(alpha, ai_alpha).astype(np.uint8)
    if int(np.count_nonzero(new_alpha > 10)) == 0:
        raise RuntimeError("La máscara generada por rembg resultó completamente vacía.")

    if feather > 0:
        fg_bin = np.where(new_alpha >= 128, 255, 0).astype(np.uint8)
        kernel_small = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        edge_band = cv2.dilate(fg_bin, kernel_small) - cv2.erode(fg_bin, kernel_small)
        ksize = int(feather) * 2 + 1
        blurred = cv2.GaussianBlur(new_alpha, (ksize, ksize), sigmaX=0.7 * feather)
        new_alpha = np.where(edge_band > 0, blurred, new_alpha).astype(np.uint8)

    clean_rgb = _decontaminate_edge_rgb(rgb, new_alpha)
    return clean_rgb, new_alpha


def remove_image_background_rgba(
    rgb,
    alpha,
    *,
    mode: str = "smart_subject",
    tolerance: int = 28,
    feather: int = 1,
    diagnostics: Optional[Dict[str, Any]] = None,
):
    """
    Remove background from an RGB+Alpha sticker array and return clean, halo-free `(rgb, new_alpha)`.

    Modes:
    - `ai_rembg`: AI salient-object segmentation via `rembg` using lightweight `u2netp` ONNX model
      (lazy-loaded and cached in memory on first request so FastAPI startup RAM is unaffected).
      If `rembg` or `onnxruntime` is not installed in the environment (or model initialization fails),
      cleanly falls back to OpenCV `smart_subject` without breaking the server.
    - `smart_subject` (recommended default): Automatically detects the main design subject using
      multi-cluster CIELAB border modeling, border-connected flood segmentation, adaptive GrabCut
      refinement on complex/shaded/photo backdrops, main-subject component isolation, and
      anti-halo edge color decontamination.
    - `auto_color`: Border-seeded CIELAB perceptual flood-fill (preserves internal white details).
    - `grabcut`: Color-guided OpenCV GrabCut GMM segmentation for complex photo backdrops.
    """
    import cv2
    import numpy as np

    effective_mode = mode
    if diagnostics is not None:
        diagnostics["bg_mode_requested"] = mode
        diagnostics["bg_mode_effective"] = mode
        diagnostics["bg_fallback_used"] = False

    if mode == "ai_rembg":
        try:
            clean_rgb, new_alpha = _remove_background_with_rembg(
                rgb,
                alpha,
                feather=feather,
                model_name=REMBG_DEFAULT_MODEL,
            )
            if diagnostics is not None:
                diagnostics["bg_mode_effective"] = "ai_rembg"
                diagnostics["bg_model"] = REMBG_DEFAULT_MODEL
            return clean_rgb, new_alpha
        except ImportError as exc:
            reason = (
                "rembg/onnxruntime no está instalado en el entorno; "
                "se aplicó fallback automático al modo 'smart_subject' de OpenCV."
            )
            logger.warning("Modo ai_rembg no disponible (%s). %s", exc, reason)
            effective_mode = "smart_subject"
            if diagnostics is not None:
                diagnostics["bg_mode_effective"] = "smart_subject"
                diagnostics["bg_fallback_used"] = True
                diagnostics["bg_fallback_reason"] = reason
        except Exception as exc:
            reason = (
                f"Fallo al ejecutar rembg ({REMBG_DEFAULT_MODEL}: {exc}); "
                "se aplicó fallback automático al modo 'smart_subject' de OpenCV."
            )
            logger.warning("Error en ai_rembg (%s). Fallback limpio a smart_subject.", exc)
            effective_mode = "smart_subject"
            if diagnostics is not None:
                diagnostics["bg_mode_effective"] = "smart_subject"
                diagnostics["bg_fallback_used"] = True
                diagnostics["bg_fallback_reason"] = reason

    h, w = rgb.shape[:2]
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    refs, border_spread = _extract_border_bg_clusters(lab, alpha, max_k=4)

    if not refs:
        return rgb, alpha

    min_dist = np.full((h, w), np.inf, dtype=np.float32)
    for ref in refs:
        dist = np.linalg.norm(lab - ref[None, None, :], axis=2)
        min_dist = np.minimum(min_dist, dist)

    thresh = float(max(5, tolerance)) * 1.15

    def _border_connected(candidate_bool):
        cand_u8 = candidate_bool.astype(np.uint8)
        _, labels = cv2.connectedComponents(cand_u8, connectivity=4)
        b_labels = set(np.unique(labels[0, :]).tolist())
        b_labels.update(np.unique(labels[-1, :]).tolist())
        b_labels.update(np.unique(labels[:, 0]).tolist())
        b_labels.update(np.unique(labels[:, -1]).tolist())
        b_labels.discard(0)
        if not b_labels:
            return np.zeros((h, w), dtype=bool)
        return np.isin(labels, list(b_labels))

    def _run_guided_grabcut(sure_bg_mask, prob_bg_mask):
        # Cap working dimension to 640px for fast responsive previews, then upscale mask cleanly
        max_dim = max(h, w)
        if max_dim > 640:
            scale = 640.0 / max_dim
            gw = max(32, int(round(w * scale)))
            gh = max(32, int(round(h * scale)))
            bgr_small = cv2.resize(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), (gw, gh), interpolation=cv2.INTER_AREA)
            s_bg = cv2.resize(sure_bg_mask.astype(np.uint8), (gw, gh), interpolation=cv2.INTER_NEAREST) > 0
            p_bg = cv2.resize(prob_bg_mask.astype(np.uint8), (gw, gh), interpolation=cv2.INTER_NEAREST) > 0
            dist_s = cv2.resize(min_dist, (gw, gh), interpolation=cv2.INTER_AREA)
            alpha_s = cv2.resize(alpha, (gw, gh), interpolation=cv2.INTER_NEAREST)
        else:
            gw, gh = w, h
            bgr_small = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
            s_bg = sure_bg_mask
            p_bg = prob_bg_mask
            dist_s = min_dist
            alpha_s = alpha

        gc_mask = np.full((gh, gw), cv2.GC_PR_FGD, dtype=np.uint8)
        border = max(2, min(gh, gw) // 24)
        gc_mask[:border, :] = cv2.GC_PR_BGD
        gc_mask[-border:, :] = cv2.GC_PR_BGD
        gc_mask[:, :border] = cv2.GC_PR_BGD
        gc_mask[:, -border:] = cv2.GC_PR_BGD

        gc_mask[p_bg] = cv2.GC_PR_BGD
        gc_mask[s_bg] = cv2.GC_BGD
        gc_mask[alpha_s < 20] = cv2.GC_BGD

        # Mark high-contrast non-border interior core as definite foreground
        core_fg = (~p_bg) & (alpha_s >= 20) & (dist_s >= max(thresh * 1.35, 32.0))
        if int(np.count_nonzero(core_fg)) > 32:
            k_er = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            core_eroded = cv2.erode(core_fg.astype(np.uint8) * 255, k_er, iterations=1) > 0
            if int(np.count_nonzero(core_eroded)) > 16:
                gc_mask[core_eroded] = cv2.GC_FGD

        # GrabCut requires both BG and FG labels to exist
        if not np.any((gc_mask == cv2.GC_BGD) | (gc_mask == cv2.GC_PR_BGD)):
            return None
        if not np.any((gc_mask == cv2.GC_FGD) | (gc_mask == cv2.GC_PR_FGD)):
            return None

        bgd_model = np.zeros((1, 65), np.float64)
        fgd_model = np.zeros((1, 65), np.float64)
        try:
            cv2.grabCut(bgr_small, gc_mask, None, bgd_model, fgd_model, 4, cv2.GC_INIT_WITH_MASK)
            fg_small = np.where((gc_mask == cv2.GC_FGD) | (gc_mask == cv2.GC_PR_FGD), 255, 0).astype(
                np.uint8
            )
            if max_dim > 640:
                fg_full = cv2.resize(fg_small, (w, h), interpolation=cv2.INTER_LINEAR)
                _, fg_full = cv2.threshold(fg_full, 127, 255, cv2.THRESH_BINARY)
                return fg_full
            return fg_small
        except Exception:
            return None

    sure_bg = _border_connected((min_dist <= thresh) | (alpha < 20))
    prob_bg = _border_connected((min_dist <= thresh * 1.45) | (alpha < 20))

    if effective_mode == "grabcut":
        gc_res = _run_guided_grabcut(sure_bg, prob_bg)
        if gc_res is not None and int(np.count_nonzero(gc_res)) >= int(h * w * 0.01):
            fg_bin = _keep_main_design_components(gc_res)
        else:
            fg_bin = np.where(sure_bg, 0, 255).astype(np.uint8)
    elif effective_mode == "smart_subject":
        # Decide cleanly between crisp border-connected matting (uniform/graphic backdrops)
        # and color-guided GrabCut (complex/photo/shaded backdrops)
        is_complex_backdrop = border_spread > 15.0 or float(np.mean(sure_bg)) < 0.03
        if is_complex_backdrop:
            gc_res = _run_guided_grabcut(sure_bg, prob_bg)
            if gc_res is not None and 0.01 <= (np.count_nonzero(gc_res) / float(h * w)) <= 0.96:
                fg_bin = gc_res
            else:
                fg_bin = np.where(sure_bg, 0, 255).astype(np.uint8)
        else:
            fg_bin = np.where(sure_bg, 0, 255).astype(np.uint8)

        # Keep main design subject & substantial companion elements, removing corner noise
        fg_bin = _keep_main_design_components(fg_bin)
    else:
        # Classic `auto_color` (strict border-connected CIELAB flood-fill preserving internal whites)
        if not np.any(sure_bg):
            return rgb, alpha
        fg_bin = np.where(sure_bg, 0, 255).astype(np.uint8)

    kernel_small = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    fg_bin = cv2.morphologyEx(fg_bin, cv2.MORPH_OPEN, kernel_small, iterations=1)
    fg_bin = cv2.morphologyEx(fg_bin, cv2.MORPH_CLOSE, kernel_small, iterations=1)

    new_alpha = np.minimum(alpha, fg_bin).astype(np.uint8)

    # Smooth anti-aliased edge ramp using CIELAB distance so light/white backdrop fringe disappears cleanly
    edge_band = cv2.dilate(fg_bin, kernel_small) - cv2.erode(fg_bin, kernel_small)
    if np.any(edge_band > 0):
        t_lo = max(2.0, thresh * 0.72)
        t_hi = max(t_lo + 8.0, thresh * 1.25)
        ramp = np.clip((min_dist - t_lo) / (t_hi - t_lo), 0.0, 1.0)
        ramp_u8 = np.rint(ramp * 255.0).clip(0, 255).astype(np.uint8)
        edge_alpha = np.minimum(new_alpha, ramp_u8)
        new_alpha = np.where(edge_band > 0, edge_alpha, new_alpha).astype(np.uint8)

    if feather > 0:
        ksize = int(feather) * 2 + 1
        blurred = cv2.GaussianBlur(new_alpha, (ksize, ksize), sigmaX=0.7 * feather)
        new_alpha = np.where(edge_band > 0, blurred, new_alpha).astype(np.uint8)

    # Decontaminate outer edge RGB so ZERO white/gray fringe remains around the transparent cutout
    clean_rgb = _decontaminate_edge_rgb(rgb, new_alpha)
    return clean_rgb, new_alpha


class ImageEnhancerService(BaseImageProcessor[EnhancePayload, ProcessingResult]):
    """Enhances sticker artwork resolution, background transparency, tone, and CMYK calibration."""

    module_name = "image_enhancer"

    def is_available(self) -> bool:
        deps = check_phase2_dependencies()
        return deps["opencv"] and deps["numpy"] and deps["pillow"]

    async def process(self, payload: EnhancePayload) -> ProcessingResult:
        if not self.is_available():
            raise RuntimeError(
                "Las librerías OpenCV, NumPy y Pillow no están instaladas en el entorno Python."
            )

        if payload.asset.content_type == "image/svg+xml" or payload.asset.filename.lower().endswith(".svg"):
            raise ValueError(
                "Los archivos SVG son vectores de resolución infinita. "
                "El laboratorio de mejora y calibración CMYK opera sobre imágenes raster (PNG, JPG o WEBP)."
            )

        return self._run_pipeline(payload.asset, payload.options, item=payload.item)

    def _run_pipeline(
        self,
        asset: ImageAsset,
        opts: EnhancementOptions,
        *,
        item: Optional[Any] = None,
    ) -> ProcessingResult:
        import cv2
        import numpy as np
        from PIL import Image, ImageOps

        started = time.perf_counter()

        try:
            pil_img = Image.open(io.BytesIO(asset.content))
            pil_img = ImageOps.exif_transpose(pil_img)
            pil_rgba = pil_img.convert("RGBA")
        except Exception as exc:
            raise ValueError(
                "No se pudo decodificar la imagen. Verifica que sea PNG, JPG o WEBP válido."
            ) from exc

        orig_w, orig_h = pil_rgba.size
        rgba = np.array(pil_rgba, dtype=np.uint8)
        rgb = rgba[:, :, :3]
        alpha = rgba[:, :, 3]

        bg_removed = False
        bg_diagnostics: Dict[str, Any] = {}
        if opts.remove_background:
            rgb, alpha = remove_image_background_rgba(
                rgb,
                alpha,
                mode=opts.bg_mode,
                tolerance=opts.bg_tolerance,
                feather=opts.bg_feather,
                diagnostics=bg_diagnostics,
            )
            bg_removed = True

        scale = float(opts.upscale_factor)
        if scale > 1.0:
            longest = max(orig_w, orig_h)
            effective_scale = min(scale, MAX_OUTPUT_DIMENSION_PX / float(longest))
            if effective_scale > 1.01:
                new_w = max(1, int(round(orig_w * effective_scale)))
                new_h = max(1, int(round(orig_h * effective_scale)))

                alpha_f = alpha.astype(np.float32) / 255.0
                premult_rgb = rgb.astype(np.float32) * alpha_f[:, :, None]

                resized_premult = cv2.resize(
                    premult_rgb, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4
                )
                resized_alpha = cv2.resize(
                    alpha_f, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4
                )
                resized_alpha = np.clip(resized_alpha, 0.0, 1.0)

                safe_a = np.where(resized_alpha > 1e-4, resized_alpha, 1.0)
                unpremult = np.where(
                    resized_alpha[:, :, None] > 1e-4,
                    resized_premult / safe_a[:, :, None],
                    0.0,
                )
                rgb = np.clip(np.rint(unpremult), 0.0, 255.0).astype(np.uint8)
                alpha = np.clip(np.rint(resized_alpha * 255.0), 0.0, 255.0).astype(np.uint8)

        out_h, out_w = rgb.shape[:2]

        if opts.denoise_strength > 0:
            strength = int(opts.denoise_strength)
            if strength <= 45:
                sigma_color = 12.0 + strength * 1.4
                sigma_space = 8.0 + strength * 0.4
                rgb = cv2.bilateralFilter(rgb, d=5, sigmaColor=sigma_color, sigmaSpace=sigma_space)
            else:
                h_param = 3.0 + (strength - 45) * 0.22
                bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
                bgr_denoised = cv2.fastNlMeansDenoisingColored(
                    bgr, None, h=h_param, hColor=h_param, templateWindowSize=7, searchWindowSize=15
                )
                rgb = cv2.cvtColor(bgr_denoised, cv2.COLOR_BGR2RGB)

        if opts.auto_contrast:
            lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
            l_ch, a_ch, b_ch = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
            l_enhanced = clahe.apply(l_ch)
            rgb = cv2.cvtColor(cv2.merge((l_enhanced, a_ch, b_ch)), cv2.COLOR_LAB2RGB)

        if opts.brightness != 0 or opts.contrast != 0:
            rgb_f = rgb.astype(np.float32)
            if opts.contrast >= 0:
                contrast_factor = 1.0 + (opts.contrast / 100.0) * 1.5
            else:
                contrast_factor = max(0.1, 1.0 + (opts.contrast / 110.0))

            brightness_shift = opts.brightness * 1.25
            rgb_f = (rgb_f - 127.5) * contrast_factor + 127.5 + brightness_shift
            rgb = np.clip(rgb_f, 0.0, 255.0).astype(np.uint8)

        if abs(opts.gamma - 1.0) > 1e-3:
            inv_gamma = 1.0 / max(0.2, float(opts.gamma))
            lut = np.array(
                [min(255, max(0, int(round(((i / 255.0) ** inv_gamma) * 255.0)))) for i in range(256)],
                dtype=np.uint8,
            )
            rgb = cv2.LUT(rgb, lut)

        if opts.saturation != 0:
            hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV).astype(np.float32)
            sat_factor = max(0.0, 1.0 + (opts.saturation / 100.0))
            hsv[:, :, 1] = np.clip(hsv[:, :, 1] * sat_factor, 0.0, 255.0)
            rgb = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB)

        if opts.sharpen_strength > 0:
            amount = (opts.sharpen_strength / 100.0) * 1.8
            blurred = cv2.GaussianBlur(rgb, (0, 0), sigmaX=1.2)
            rgb = cv2.addWeighted(rgb, 1.0 + amount, blurred, -amount, 0)

        c, m, y, k = self._rgb_to_cmyk(rgb)

        has_cmyk_shift = any(v != 0 for v in (opts.cyan, opts.magenta, opts.yellow, opts.black))
        if has_cmyk_shift:
            c = np.clip(c + (opts.cyan / 100.0), 0.0, 1.0)
            m = np.clip(m + (opts.magenta / 100.0), 0.0, 1.0)
            y = np.clip(y + (opts.yellow / 100.0), 0.0, 1.0)
            k = np.clip(k + (opts.black / 100.0), 0.0, 1.0)

        if opts.ink_limit_percent < 400:
            limit = opts.ink_limit_percent / 100.0
            tac = c + m + y + k
            excess_mask = tac > limit
            if np.any(excess_mask):
                ratio = np.where(excess_mask, limit / np.maximum(tac, 1e-6), 1.0)
                c = c * ratio
                m = m * ratio
                y = y * ratio
                k = k * ratio

        cmyk_stats = self._compute_cmyk_stats(c, m, y, k, alpha)

        dpi = int(opts.target_dpi)
        resolved_size_cm = resolve_physical_size_cm(item, out_w, out_h) if item is not None else None
        if resolved_size_cm is not None:
            physical_w_cm, physical_h_cm = resolved_size_cm
            eff_dpi, eff_status = compute_effective_dpi_for_item(item, out_w, out_h)
        else:
            physical_w_cm = round((out_w / dpi) * 2.54, 2)
            physical_h_cm = round((out_h / dpi) * 2.54, 2)
            eff_dpi, eff_status = None, None

        output_bytes, content_type, extension = self._encode_output(
            c, m, y, k, alpha, dpi=dpi, output_format=opts.output_format
        )

        elapsed_ms = round((time.perf_counter() - started) * 1000.0, 1)

        metadata: Dict[str, object] = {
            "output_format": opts.output_format,
            "ink_limit_percent": opts.ink_limit_percent,
            "has_transparency": bool(np.any(alpha < 255)),
            "background_removed": bg_removed,
        }
        if eff_dpi is not None:
            metadata["effective_dpi"] = eff_dpi
            metadata["dpi_status"] = eff_status
        if bg_diagnostics:
            metadata.update(bg_diagnostics)

        return ProcessingResult(
            output_bytes=output_bytes,
            content_type=content_type,
            extension=extension,
            original_width=orig_w,
            original_height=orig_h,
            width_px=out_w,
            height_px=out_h,
            dpi=dpi,
            physical_width_cm=physical_w_cm,
            physical_height_cm=physical_h_cm,
            cmyk_stats=cmyk_stats,
            processing_time_ms=elapsed_ms,
            metadata=metadata,
        )

    @staticmethod
    def _rgb_to_cmyk(rgb) -> Tuple[object, object, object, object]:
        import numpy as np

        rgb_norm = rgb.astype(np.float32) / 255.0
        r = rgb_norm[:, :, 0]
        g = rgb_norm[:, :, 1]
        b = rgb_norm[:, :, 2]

        k = 1.0 - np.maximum(np.maximum(r, g), b)
        denom = np.maximum(1.0 - k, 1e-6)
        non_black = k < 0.9999

        c = np.where(non_black, (1.0 - r - k) / denom, 0.0)
        m = np.where(non_black, (1.0 - g - k) / denom, 0.0)
        y = np.where(non_black, (1.0 - b - k) / denom, 0.0)
        return (
            np.clip(c, 0.0, 1.0),
            np.clip(m, 0.0, 1.0),
            np.clip(y, 0.0, 1.0),
            np.clip(k, 0.0, 1.0),
        )

    @staticmethod
    def _cmyk_to_rgb(c, m, y, k):
        import numpy as np

        one_minus_k = 1.0 - k
        r = (1.0 - c) * one_minus_k
        g = (1.0 - m) * one_minus_k
        b = (1.0 - y) * one_minus_k
        rgb = np.stack([r, g, b], axis=2)
        return np.clip(rgb * 255.0, 0.0, 255.0).astype(np.uint8)

    @staticmethod
    def _compute_cmyk_stats(c, m, y, k, alpha) -> CmykStats:
        import numpy as np

        opaque = alpha > 10
        if not np.any(opaque):
            return CmykStats(
                avg_cyan=0.0,
                avg_magenta=0.0,
                avg_yellow=0.0,
                avg_black=0.0,
                max_tac_percent=0.0,
                tac_warning=False,
            )

        c_vals = c[opaque]
        m_vals = m[opaque]
        y_vals = y[opaque]
        k_vals = k[opaque]
        tac_vals = (c_vals + m_vals + y_vals + k_vals) * 100.0

        max_tac = round(float(np.percentile(tac_vals, 99.5)), 1)
        return CmykStats(
            avg_cyan=round(float(np.mean(c_vals) * 100.0), 1),
            avg_magenta=round(float(np.mean(m_vals) * 100.0), 1),
            avg_yellow=round(float(np.mean(y_vals) * 100.0), 1),
            avg_black=round(float(np.mean(k_vals) * 100.0), 1),
            max_tac_percent=max_tac,
            tac_warning=max_tac > 300.0,
        )

    def _encode_output(
        self, c, m, y, k, alpha, *, dpi: int, output_format: str
    ) -> Tuple[bytes, str, str]:
        import numpy as np
        from PIL import Image

        buf = io.BytesIO()

        if output_format in ("tiff_cmyk", "jpeg_cmyk"):
            a_norm = alpha.astype(np.float32) / 255.0
            cmyk_stack = np.stack(
                [c * a_norm, m * a_norm, y * a_norm, k * a_norm],
                axis=2,
            )
            cmyk_u8 = np.clip(cmyk_stack * 255.0, 0.0, 255.0).astype(np.uint8)
            pil_cmyk = Image.fromarray(cmyk_u8, mode="CMYK")

            if output_format == "tiff_cmyk":
                pil_cmyk.save(
                    buf,
                    format="TIFF",
                    compression="tiff_adobe_deflate",
                    dpi=(dpi, dpi),
                )
                return buf.getvalue(), "image/tiff", ".tif"

            pil_cmyk.save(
                buf,
                format="JPEG",
                quality=95,
                subsampling=0,
                dpi=(dpi, dpi),
            )
            return buf.getvalue(), "image/jpeg", ".jpg"

        rgb_u8 = self._cmyk_to_rgb(c, m, y, k)
        rgba_u8 = np.dstack([rgb_u8, alpha])
        pil_rgba = Image.fromarray(rgba_u8, mode="RGBA")
        pil_rgba.save(buf, format="PNG", dpi=(dpi, dpi), optimize=True)
        return buf.getvalue(), "image/png", ".png"
