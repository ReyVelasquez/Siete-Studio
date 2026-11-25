"""
Phase 2 - Content-Aware Object Eraser & Watermark Removal Studio (OpenCV + NumPy).

Provides Illustrator/Photoshop-style retouching capabilities for sticker prepress:
1. `inpaint_telea`: Fast-Marching content-aware reconstruction with component-aware CIELAB
   base-color detection & boundary purification so dark/outlier fringes never bleed into
   clean surfaces (e.g., erasing black dots on a yellow surface restores pure yellow).
2. `inpaint_ns`: Navier-Stokes fluid-dynamics isophote continuation for smooth gradients & textures.
3. `watermark_clean`: Specialized semi-transparent watermark remover preserving underlying color fields
   via purified CIELAB background envelope reconstruction.
4. `erase_transparent`: Alpha-channel eraser with optional anti-aliased edge feathering for PNG cutouts.
5. `detect_watermark_mask`: Morphological top-hat / black-hat detector in CIELAB luminance + low-chroma
   filtering to propose an editable mask over subtle repeating light/dark watermarks.
"""

from __future__ import annotations

import io
import re
import time
from dataclasses import dataclass
from typing import List, Literal, Optional, Tuple

from app.modules.image_processing.base import check_phase2_dependencies

RetouchMode = Literal[
    "inpaint_telea",
    "inpaint_ns",
    "watermark_clean",
    "erase_transparent",
]

WatermarkTone = Literal["light", "dark", "both"]

MAX_RETOUCH_DIMENSION_PX = 4096

_HEX_COLOR_RE = re.compile(r"^#?([0-9a-fA-F]{6})$")


@dataclass(frozen=True)
class RetouchInpaintResult:
    output_bytes: bytes
    width: int
    height: int
    masked_pixels: int
    masked_percent: float
    mode: RetouchMode
    processing_time_ms: float
    has_transparency: bool
    detected_base_color: Optional[str] = None


@dataclass(frozen=True)
class WatermarkMaskResult:
    mask_png_bytes: bytes
    width: int
    height: int
    detected_pixels: int
    detected_percent: float
    processing_time_ms: float


def parse_hex_color(hex_str: Optional[str]) -> Optional[Tuple[int, int, int]]:
    """Parse '#RRGGBB' or 'RRGGBB' into an (R, G, B) uint8 tuple, or None if empty."""
    if not hex_str:
        return None
    cleaned = hex_str.strip()
    if not cleaned:
        return None
    match = _HEX_COLOR_RE.match(cleaned)
    if not match:
        raise ValueError(f"Color hexadecimal inválido: '{hex_str}'. Usa formato #RRGGBB.")
    raw = match.group(1)
    return (int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16))


def rgb_to_hex(rgb_tuple: Tuple[int, int, int]) -> str:
    r, g, b = (max(0, min(255, int(round(c)))) for c in rgb_tuple)
    return f"#{r:02X}{g:02X}{b:02X}"


def _decode_rgba(raw_bytes: bytes):
    """Decode raw PNG/JPG/WEBP bytes into uint8 RGBA numpy array (H, W, 4)."""
    import numpy as np
    from PIL import Image, ImageOps

    try:
        pil = Image.open(io.BytesIO(raw_bytes))
        pil = ImageOps.exif_transpose(pil)
        rgba = pil.convert("RGBA")
    except Exception as exc:
        raise ValueError("No se pudo decodificar la imagen para retoque.") from exc

    w, h = rgba.size
    if w > MAX_RETOUCH_DIMENSION_PX or h > MAX_RETOUCH_DIMENSION_PX:
        ratio = min(MAX_RETOUCH_DIMENSION_PX / w, MAX_RETOUCH_DIMENSION_PX / h)
        rgba = rgba.resize((max(1, int(w * ratio)), max(1, int(h * ratio))), Image.Resampling.LANCZOS)

    return np.array(rgba, dtype=np.uint8)


def _decode_mask(mask_bytes: bytes, target_w: int, target_h: int):
    """
    Decode browser-painted mask PNG into a single-channel uint8 binary mask (0 or 255)
    matching exact (target_h, target_w). Accepts either alpha-painted PNGs or grayscale masks.
    """
    import cv2
    import numpy as np
    from PIL import Image

    try:
        pil = Image.open(io.BytesIO(mask_bytes))
    except Exception as exc:
        raise ValueError("No se pudo decodificar la máscara del borrador.") from exc

    if pil.mode in ("RGBA", "LA") or "transparency" in pil.info:
        rgba = np.array(pil.convert("RGBA"), dtype=np.uint8)
        alpha_ch = rgba[:, :, 3]
        if int(np.min(alpha_ch)) < 250 and int(np.max(alpha_ch)) > 0:
            raw_mask = alpha_ch
        else:
            raw_mask = cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_RGB2GRAY)
    else:
        raw_mask = np.array(pil.convert("L"), dtype=np.uint8)

    if raw_mask.shape[1] != target_w or raw_mask.shape[0] != target_h:
        raw_mask = cv2.resize(raw_mask, (target_w, target_h), interpolation=cv2.INTER_NEAREST)

    return np.where(raw_mask >= 24, 255, 0).astype(np.uint8)


def _prefill_transparent_rgb(rgb, alpha):
    """
    Prevent black-fringe bleed during OpenCV inpainting when an RGBA sticker has transparent
    or semi-transparent premultiplied regions. Fills low-alpha RGB from nearby opaque colors.
    """
    import cv2
    import numpy as np

    transparent_mask = np.where(alpha < 32, 255, 0).astype(np.uint8)
    nz = int(np.count_nonzero(transparent_mask))
    if nz == 0 or nz == alpha.size:
        return rgb

    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    filled_bgr = cv2.inpaint(bgr, transparent_mask, 5, cv2.INPAINT_TELEA)
    return cv2.cvtColor(filled_bgr, cv2.COLOR_BGR2RGB)


def _compute_soft_blend_weights(hard_mask, feather_px: int):
    """Build a float32 [0..1] blending weight mask with optional feathered transition edge."""
    import cv2
    import numpy as np

    if feather_px <= 0:
        return (hard_mask.astype(np.float32) / 255.0)[:, :, None]

    k = max(3, int(feather_px) * 2 + 1)
    if k % 2 == 0:
        k += 1
    blurred = cv2.GaussianBlur(hard_mask.astype(np.float32) / 255.0, (k, k), 0)
    core = hard_mask.astype(np.float32) / 255.0
    blended = np.maximum(core * 0.92, blurred)
    blended = np.where(core > 0.5, np.clip(blended * 1.09, 0.0, 1.0), blurred)
    return np.clip(blended, 0.0, 1.0)[:, :, None]


def _encode_rgba_png(rgba) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _cluster_ring_lab_colors(
    ring_lab,
    ring_rgb,
    *,
    max_k: int = 4,
) -> List[Tuple[float, "object", Tuple[int, int, int]]]:
    """
    Cluster surrounding ring pixels in CIELAB to identify dominant base color(s)
    without being skewed by dark/bright contaminant outliers.

    Returns list of (share, median_lab_float32, median_rgb_tuple) sorted by share descending.
    """
    import cv2
    import numpy as np

    n = len(ring_lab)
    if n == 0:
        return []

    # Check if the surrounding ring is already nearly uniform
    med_lab = np.median(ring_lab, axis=0).astype(np.float32)
    dists_to_med = np.linalg.norm(ring_lab - med_lab[None, :], axis=1)
    if n < 24 or float(np.percentile(dists_to_med, 85)) < 12.0:
        med_rgb = tuple(int(round(v)) for v in np.median(ring_rgb, axis=0))
        return [(1.0, med_lab, med_rgb)]

    # Stride deterministically up to 3500 samples for fast clustering
    if n > 3500:
        step = max(1, n // 3500)
        sample_lab = ring_lab[::step]
        sample_rgb = ring_rgb[::step]
    else:
        sample_lab = ring_lab
        sample_rgb = ring_rgb

    # Estimate distinct quantized Lab bins to pick K safely
    q = (sample_lab // 14).astype(np.int32)
    unique_bins = len(np.unique(q[:, 0] * 65536 + q[:, 1] * 256 + q[:, 2]))
    k = max(1, min(max_k, unique_bins, len(sample_lab)))
    if k == 1:
        med_rgb = tuple(int(round(v)) for v in np.median(sample_rgb, axis=0))
        return [(1.0, med_lab, med_rgb)]

    cv2.setRNGSeed(42)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, _ = cv2.kmeans(
        sample_lab.astype(np.float32),
        k,
        None,
        criteria,
        3,
        cv2.KMEANS_PP_CENTERS,
    )
    labels_flat = labels.ravel()
    total = float(len(labels_flat))

    raw_clusters: List[Tuple[float, "object", Tuple[int, int, int]]] = []
    for cid in range(k):
        sel = labels_flat == cid
        cnt = int(np.count_nonzero(sel))
        if cnt == 0:
            continue
        c_lab = np.median(sample_lab[sel], axis=0).astype(np.float32)
        c_rgb = tuple(int(round(v)) for v in np.median(sample_rgb[sel], axis=0))
        raw_clusters.append((cnt / total, c_lab, c_rgb))

    raw_clusters.sort(key=lambda item: item[0], reverse=True)

    # Merge clusters that are perceptually close (< 13 Lab units) so a slight gradient
    # across the base color doesn't get split into small sub-clusters
    merged: List[Tuple[float, "object", Tuple[int, int, int]]] = []
    for share, c_lab, c_rgb in raw_clusters:
        absorbed = False
        for idx, (m_share, m_lab, m_rgb) in enumerate(merged):
            if float(np.linalg.norm(c_lab - m_lab)) < 13.0:
                new_share = m_share + share
                # Keep the dominant sub-cluster's exact median color
                merged[idx] = (new_share, m_lab, m_rgb)
                absorbed = True
                break
        if not absorbed:
            merged.append((share, c_lab, c_rgb))

    merged.sort(key=lambda item: item[0], reverse=True)
    return merged


def _purify_and_detect_base_colors(
    safe_rgb,
    alpha,
    work_mask,
    *,
    radius: int,
    mask_dilate: int,
    explicit_base_rgb: Optional[Tuple[int, int, int]] = None,
):
    """
    Component-aware base-color detector & boundary purifier.

    Solves the classic inpainting failure where dark/outlier fringe pixels (or neighboring
    speckles, e.g. black dots on a yellow surface) sit right on the mask boundary and cause
    OpenCV Telea/NS to flood the erased area with black instead of the surrounding yellow.

    Returns:
      - `clean_rgb`: Temporary source image with purified boundary rings (used ONLY as
        input to cv2.inpaint; untouched pixels outside the mask are never written back).
      - `effective_mask`: Mask lightly expanded into directly touching artifact fringe
        pixels (capped tightly within `ring_near_px`).
      - `primary_base_hex`: Hex color of the primary detected/locked base background color.
      - `uniform_fill_rgb`: Optional per-pixel uniform base-color reference for flat regions.
      - `uniform_fill_mask`: Binary mask of components surrounded by a flat single base color.
    """
    import cv2
    import math
    import numpy as np

    h, w = safe_rgb.shape[:2]
    clean_rgb = safe_rgb.copy()
    effective_mask = work_mask.copy()
    uniform_fill_rgb = safe_rgb.copy()
    uniform_fill_mask = np.zeros((h, w), dtype=np.uint8)

    explicit_lab = None
    if explicit_base_rgb is not None:
        patch = np.array([[list(explicit_base_rgb)]], dtype=np.uint8)
        explicit_lab = cv2.cvtColor(patch, cv2.COLOR_RGB2LAB)[0, 0].astype(np.float32)

    num_labels, comp_labels, stats, _ = cv2.connectedComponentsWithStats(work_mask, connectivity=8)
    if num_labels <= 1:
        return (
            clean_rgb,
            effective_mask,
            rgb_to_hex(explicit_base_rgb) if explicit_base_rgb else None,
            uniform_fill_rgb,
            uniform_fill_mask,
        )

    ring_outer_px = max(14, min(48, radius * 3))
    # Skip band for clean outer-ring color sampling ONLY (never expands the erased mask)
    sample_skip_px = max(3, min(6, mask_dilate + 2))
    pad_px = ring_outer_px + 6

    largest_comp_area = -1
    primary_base_rgb: Optional[Tuple[int, int, int]] = explicit_base_rgb

    for comp_id in range(1, num_labels):
        comp_area = int(stats[comp_id, cv2.CC_STAT_AREA])
        if comp_area <= 0:
            continue

        comp_radius = math.sqrt(comp_area / math.pi)
        # Strictly respect small/surgical brush sizes: NEVER blow up tiny brush clicks!
        if mask_dilate <= 0 or comp_radius <= 5.5:
            fringe_absorb_px = 0
        else:
            fringe_absorb_px = min(2, int(mask_dilate))

        x0 = max(0, int(stats[comp_id, cv2.CC_STAT_LEFT]) - pad_px)
        y0 = max(0, int(stats[comp_id, cv2.CC_STAT_TOP]) - pad_px)
        x1 = min(w, int(stats[comp_id, cv2.CC_STAT_LEFT] + stats[comp_id, cv2.CC_STAT_WIDTH]) + pad_px)
        y1 = min(h, int(stats[comp_id, cv2.CC_STAT_TOP] + stats[comp_id, cv2.CC_STAT_HEIGHT]) + pad_px)

        roi_rgb = safe_rgb[y0:y1, x0:x1]
        roi_alpha = alpha[y0:y1, x0:x1]
        roi_all_mask = work_mask[y0:y1, x0:x1]
        roi_comp = (comp_labels[y0:y1, x0:x1] == comp_id).astype(np.uint8) * 255
        roi_lab = cv2.cvtColor(roi_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)

        k_outer = ring_outer_px * 2 + 1
        k_skip = sample_skip_px * 2 + 1
        outer_dil = cv2.dilate(
            roi_comp, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_outer, k_outer))
        )
        skip_dil = cv2.dilate(
            roi_comp, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_skip, k_skip))
        )

        opaque = roi_alpha >= 160
        if int(np.count_nonzero(opaque & (outer_dil > 0) & (roi_all_mask == 0))) < 20:
            opaque = roi_alpha >= 20

        ring_all = (outer_dil > 0) & (roi_all_mask == 0) & opaque
        ring_far = (outer_dil > 0) & (skip_dil == 0) & (roi_all_mask == 0) & opaque

        if fringe_absorb_px > 0:
            k_fringe = fringe_absorb_px * 2 + 1
            fringe_dil = cv2.dilate(
                roi_comp, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_fringe, k_fringe))
            )
            ring_fringe = (fringe_dil > 0) & (roi_all_mask == 0) & opaque
        else:
            ring_fringe = None

        if int(np.count_nonzero(ring_all)) < 12:
            if explicit_base_rgb is not None:
                uniform_fill_rgb[y0:y1, x0:x1][roi_comp > 0] = explicit_base_rgb
                uniform_fill_mask[y0:y1, x0:x1][roi_comp > 0] = 255
            continue

        sample_region = ring_far if int(np.count_nonzero(ring_far)) >= 40 else ring_all
        inside_lab = roi_lab[roi_comp > 0]

        if explicit_base_rgb is not None and explicit_lab is not None:
            bg_primary_lab = explicit_lab
            bg_primary_rgb = explicit_base_rgb
            valid_bg_labs = [explicit_lab]
            is_flat_single_bg = True
        else:
            clusters = _cluster_ring_lab_colors(
                roi_lab[sample_region],
                roi_rgb[sample_region],
                max_k=4,
            )
            if not clusters:
                continue

            # If top 2 clusters have similar share, prefer the one less similar to the
            # masked interior (what the user explicitly painted to erase)
            if len(clusters) >= 2 and (clusters[0][0] - clusters[1][0]) < 0.14 and len(inside_lab) > 0:
                inside_med = np.median(inside_lab, axis=0)
                d0 = float(np.linalg.norm(clusters[0][1] - inside_med))
                d1 = float(np.linalg.norm(clusters[1][1] - inside_med))
                if d1 > d0 + 18.0:
                    clusters[0], clusters[1] = clusters[1], clusters[0]

            primary_share, bg_primary_lab, bg_primary_rgb = clusters[0]

            # Identify the foreground/artifact color inside the user's stroke:
            # top 30% pixels inside comp_mask most distinct from bg_primary_lab
            inside_dist = np.linalg.norm(inside_lab - bg_primary_lab[None, :], axis=1)
            cutoff = float(np.percentile(inside_dist, 70)) if len(inside_dist) >= 4 else 0.0
            fg_sel = inside_dist >= max(cutoff, 14.0)
            fg_artifact_lab = (
                np.median(inside_lab[fg_sel], axis=0).astype(np.float32)
                if np.any(fg_sel)
                else None
            )

            # Keep genuine multi-color background clusters (e.g. yellow/blue seam) while
            # excluding minor clusters that look like the erased artifact (e.g. nearby black dots)
            valid_bg_labs = [bg_primary_lab]
            for share, c_lab, _ in clusters[1:]:
                if share < 0.22:
                    continue
                if fg_artifact_lab is not None:
                    d_to_fg = float(np.linalg.norm(c_lab - fg_artifact_lab))
                    d_to_bg = float(np.linalg.norm(c_lab - bg_primary_lab))
                    if d_to_fg < d_to_bg * 0.75 and share < 0.38:
                        continue
                valid_bg_labs.append(c_lab)

            is_flat_single_bg = len(valid_bg_labs) == 1 and primary_share >= 0.68

        if comp_area > largest_comp_area:
            largest_comp_area = comp_area
            primary_base_rgb = bg_primary_rgb

        # Compute minimum CIELAB distance of every ROI pixel to any valid background cluster
        min_bg_dist = np.full(roi_rgb.shape[:2], np.inf, dtype=np.float32)
        for v_lab in valid_bg_labs:
            d = np.linalg.norm(roi_lab - v_lab[None, None, :], axis=2)
            min_bg_dist = np.minimum(min_bg_dist, d)

        # Determine artifact signature for tight anti-fringe absorption
        if explicit_base_rgb is not None:
            inside_dist = np.linalg.norm(inside_lab - bg_primary_lab[None, :], axis=1)
            cutoff = float(np.percentile(inside_dist, 70)) if len(inside_dist) >= 4 else 0.0
            fg_sel = inside_dist >= max(cutoff, 14.0)
            fg_artifact_lab = (
                np.median(inside_lab[fg_sel], axis=0).astype(np.float32)
                if np.any(fg_sel)
                else None
            )

        # 1) Absorb tightly connected artifact fringe pixels ONLY when enabled & stroke is non-tiny
        if fg_artifact_lab is not None and ring_fringe is not None:
            dist_to_fg = np.linalg.norm(roi_lab - fg_artifact_lab[None, None, :], axis=2)
            dist_to_primary = np.linalg.norm(roi_lab - bg_primary_lab[None, None, :], axis=2)
            fringe_cand = (
                ring_fringe
                & (min_bg_dist > 18.0)
                & (dist_to_fg < dist_to_primary * 0.90)
            )
            if np.any(fringe_cand):
                union_u8 = ((roi_comp > 0) | fringe_cand).astype(np.uint8)
                _, u_labels = cv2.connectedComponents(union_u8, connectivity=8)
                touching_ids = np.unique(u_labels[roi_comp > 0])
                touching_ids = touching_ids[touching_ids != 0]
                absorbed_fringe = fringe_cand & np.isin(u_labels, touching_ids)
                if np.any(absorbed_fringe):
                    roi_comp[absorbed_fringe] = 255
                    effective_mask[y0:y1, x0:x1][absorbed_fringe] = 255

        # 2) Purify contaminant outlier pixels in the surrounding boundary ring of `clean_rgb`
        #    (never modifies output outside the mask — only stops Telea/NS from pulling black!)
        purify_band = (outer_dil > 0) & (roi_comp == 0) & (roi_all_mask == 0) & opaque
        outlier_thresh = 20.0 if explicit_base_rgb is None else 18.0
        outliers = purify_band & (min_bg_dist > outlier_thresh)
        valid_ring = purify_band & (~outliers)

        roi_clean = clean_rgb[y0:y1, x0:x1]
        if np.any(outliers):
            if explicit_base_rgb is not None and int(np.count_nonzero(valid_ring)) < 25:
                roi_clean[outliers] = bg_primary_rgb
            elif int(np.count_nonzero(valid_ring)) >= 12:
                # Exact O(N) nearest-valid-background-pixel replacement preserves gradients & multi-color seams!
                inv_valid = np.where(valid_ring, 0, 1).astype(np.uint8)
                _, nearest_labels = cv2.distanceTransformWithLabels(
                    inv_valid, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL
                )
                valid_ys, valid_xs = np.where(valid_ring)
                # distanceTransformWithLabels assigns 1-based labels in raster order of zero pixels
                out_ys, out_xs = np.where(outliers)
                lbl_idx = np.clip(nearest_labels[out_ys, out_xs] - 1, 0, len(valid_ys) - 1)
                roi_clean[out_ys, out_xs] = roi_rgb[valid_ys[lbl_idx], valid_xs[lbl_idx]]
            else:
                roi_clean[outliers] = bg_primary_rgb

        # 3) Measure whether valid ring is truly flat (solid sticker color, e.g., solid yellow)
        if is_flat_single_bg and int(np.count_nonzero(valid_ring)) >= 16:
            valid_lab_vals = roi_lab[valid_ring]
            valid_med_lab = np.median(valid_lab_vals, axis=0)
            mad = float(np.median(np.linalg.norm(valid_lab_vals - valid_med_lab[None, :], axis=1)))
            if mad < 5.5 or explicit_base_rgb is not None:
                fill_rgb = (
                    explicit_base_rgb
                    if explicit_base_rgb is not None
                    else tuple(int(round(v)) for v in np.median(roi_rgb[valid_ring], axis=0))
                )
                uniform_fill_rgb[y0:y1, x0:x1][roi_comp > 0] = fill_rgb
                uniform_fill_mask[y0:y1, x0:x1][roi_comp > 0] = 255

    detected_hex = rgb_to_hex(primary_base_rgb) if primary_base_rgb is not None else None
    return clean_rgb, effective_mask, detected_hex, uniform_fill_rgb, uniform_fill_mask


class RetouchInpaintService:
    """Content-aware object eraser and watermark removal engine built on OpenCV + NumPy."""

    module_name = "retouch_inpaint"

    def is_available(self) -> bool:
        deps = check_phase2_dependencies()
        return deps["opencv"] and deps["numpy"] and deps["pillow"]

    def inpaint_sync(
        self,
        raw_image_bytes: bytes,
        mask_bytes: bytes,
        *,
        mode: RetouchMode = "inpaint_telea",
        inpaint_radius: int = 7,
        mask_feather: int = 2,
        mask_dilate: int = 2,
        watermark_strength: int = 85,
        base_color: Optional[str] = None,
    ) -> RetouchInpaintResult:
        if not self.is_available():
            raise RuntimeError(
                "Dependencias OpenCV / NumPy / Pillow no disponibles en el servidor."
            )

        import cv2
        import numpy as np

        started = time.perf_counter()
        explicit_base_rgb = parse_hex_color(base_color)
        rgba = _decode_rgba(raw_image_bytes)
        h, w = rgba.shape[:2]
        rgb = rgba[:, :, :3].copy()
        alpha = rgba[:, :, 3].copy()

        raw_mask = _decode_mask(mask_bytes, w, h)
        masked_pixels = int(np.count_nonzero(raw_mask))
        total_pixels = max(1, h * w)

        if masked_pixels == 0:
            elapsed = round((time.perf_counter() - started) * 1000.0, 1)
            return RetouchInpaintResult(
                output_bytes=_encode_rgba_png(rgba),
                width=w,
                height=h,
                masked_pixels=0,
                masked_percent=0.0,
                mode=mode,
                processing_time_ms=elapsed,
                has_transparency=bool(np.any(alpha < 255)),
                detected_base_color=rgb_to_hex(explicit_base_rgb) if explicit_base_rgb else None,
            )

        # Optional small dilation removes residual fringe around watermark/text strokes
        work_mask = raw_mask.copy()
        if mask_dilate > 0 and mode != "erase_transparent":
            dk = mask_dilate * 2 + 1
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dk, dk))
            work_mask = cv2.dilate(work_mask, kernel, iterations=1)

        radius = max(1, min(30, int(inpaint_radius)))
        detected_base_hex: Optional[str] = (
            rgb_to_hex(explicit_base_rgb) if explicit_base_rgb else None
        )

        if mode == "erase_transparent":
            weights = _compute_soft_blend_weights(work_mask, mask_feather)[:, :, 0]
            new_alpha = np.rint(alpha.astype(np.float32) * (1.0 - weights)).clip(0, 255).astype(np.uint8)
            out_rgba = np.dstack([rgb, new_alpha])
            final_mask = work_mask
        else:
            # Prefill transparent background regions so Telea/NS never bleeds black halos
            safe_rgb = _prefill_transparent_rgb(rgb, alpha)

            # Purify surrounding boundary rings & detect exact local base color(s)
            (
                clean_rgb,
                effective_mask,
                detected_base_hex,
                uniform_fill_rgb,
                uniform_fill_mask,
            ) = _purify_and_detect_base_colors(
                safe_rgb,
                alpha,
                work_mask,
                radius=radius,
                mask_dilate=mask_dilate,
                explicit_base_rgb=explicit_base_rgb,
            )
            final_mask = effective_mask
            clean_bgr = cv2.cvtColor(clean_rgb, cv2.COLOR_RGB2BGR)
            orig_bgr = cv2.cvtColor(safe_rgb, cv2.COLOR_RGB2BGR)

            if mode == "inpaint_ns":
                reconstructed_bgr = cv2.inpaint(clean_bgr, effective_mask, radius, cv2.INPAINT_NS)
                if radius >= 6:
                    telea_bgr = cv2.inpaint(
                        clean_bgr, effective_mask, max(3, radius // 2), cv2.INPAINT_TELEA
                    )
                    reconstructed_bgr = cv2.addWeighted(reconstructed_bgr, 0.72, telea_bgr, 0.28, 0)
                reconstructed_rgb = cv2.cvtColor(reconstructed_bgr, cv2.COLOR_BGR2RGB)
                weights = _compute_soft_blend_weights(effective_mask, mask_feather)
            elif mode == "watermark_clean":
                # Build contamination-free background envelope from purified boundary ring
                telea_bgr = cv2.inpaint(clean_bgr, effective_mask, radius, cv2.INPAINT_TELEA)
                ns_bgr = cv2.inpaint(clean_bgr, effective_mask, max(3, radius), cv2.INPAINT_NS)
                env_bgr = cv2.addWeighted(telea_bgr, 0.65, ns_bgr, 0.35, 0)

                if explicit_base_rgb is not None and np.any(uniform_fill_mask > 0):
                    env_rgb_tmp = cv2.cvtColor(env_bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
                    u_w = (uniform_fill_mask.astype(np.float32) / 255.0)[:, :, None] * 0.65
                    env_rgb_tmp = env_rgb_tmp * (1.0 - u_w) + uniform_fill_rgb.astype(np.float32) * u_w
                    env_bgr = cv2.cvtColor(
                        np.rint(env_rgb_tmp).clip(0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR
                    )

                orig_lab = cv2.cvtColor(orig_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
                env_lab = cv2.cvtColor(env_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
                delta = np.linalg.norm(orig_lab - env_lab, axis=2)

                strength = max(0.2, min(1.0, float(watermark_strength) / 100.0))
                wm_confidence = np.clip((delta - 2.5) / 14.0, 0.0, 1.0)
                adaptive_alpha = np.clip(
                    (strength * 0.65) + (wm_confidence * strength * 0.55),
                    0.0,
                    1.0,
                )
                base_weights = _compute_soft_blend_weights(effective_mask, mask_feather)[:, :, 0]
                weights = (base_weights * adaptive_alpha)[:, :, None]
                reconstructed_rgb = cv2.cvtColor(env_bgr, cv2.COLOR_BGR2RGB)
            else:
                # Default: inpaint_telea with purified base-color boundary + flat-color stabilization
                reconstructed_bgr = cv2.inpaint(clean_bgr, effective_mask, radius, cv2.INPAINT_TELEA)
                reconstructed_rgb = cv2.cvtColor(reconstructed_bgr, cv2.COLOR_BGR2RGB)

                # On verified flat solid surfaces (or explicit eyedropper lock), stabilize any
                # residual Telea interpolation drift toward the exact detected base color
                if np.any(uniform_fill_mask > 0):
                    blend_strength = 0.85 if explicit_base_rgb is not None else 0.55
                    u_w = (uniform_fill_mask.astype(np.float32) / 255.0)[:, :, None] * blend_strength
                    reconstructed_rgb = (
                        np.rint(
                            reconstructed_rgb.astype(np.float32) * (1.0 - u_w)
                            + uniform_fill_rgb.astype(np.float32) * u_w
                        )
                        .clip(0, 255)
                        .astype(np.uint8)
                    )

                weights = _compute_soft_blend_weights(effective_mask, mask_feather)

            out_rgb = (
                np.rint(
                    rgb.astype(np.float32) * (1.0 - weights)
                    + reconstructed_rgb.astype(np.float32) * weights
                )
                .clip(0, 255)
                .astype(np.uint8)
            )

            # Reconstruct alpha consistently if the brushed region touches transparent edges
            if np.any(alpha < 255):
                alpha_inpainted = cv2.inpaint(
                    alpha, effective_mask, max(3, radius // 2), cv2.INPAINT_TELEA
                )
                w2d = weights[:, :, 0]
                out_alpha = (
                    np.rint(
                        alpha.astype(np.float32) * (1.0 - w2d)
                        + alpha_inpainted.astype(np.float32) * w2d
                    )
                    .clip(0, 255)
                    .astype(np.uint8)
                )
            else:
                out_alpha = alpha

            out_rgba = np.dstack([out_rgb, out_alpha])

        elapsed = round((time.perf_counter() - started) * 1000.0, 1)
        final_nz = int(np.count_nonzero(final_mask))
        return RetouchInpaintResult(
            output_bytes=_encode_rgba_png(out_rgba),
            width=w,
            height=h,
            masked_pixels=final_nz,
            masked_percent=round((final_nz / total_pixels) * 100.0, 2),
            mode=mode,
            processing_time_ms=elapsed,
            has_transparency=bool(np.any(out_rgba[:, :, 3] < 255)),
            detected_base_color=detected_base_hex,
        )

    def detect_watermark_mask_sync(
        self,
        raw_image_bytes: bytes,
        *,
        tone: WatermarkTone = "light",
        sensitivity: int = 55,
    ) -> WatermarkMaskResult:
        """
        Propose an editable binary mask over semi-transparent light or dark watermark strokes
        using CIELAB morphological top-hat/black-hat filtering combined with low-chroma weighting.
        """
        if not self.is_available():
            raise RuntimeError(
                "Dependencias OpenCV / NumPy / Pillow no disponibles en el servidor."
            )

        import cv2
        import numpy as np

        started = time.perf_counter()
        rgba = _decode_rgba(raw_image_bytes)
        h, w = rgba.shape[:2]
        rgb = rgba[:, :, :3]
        alpha = rgba[:, :, 3]

        lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
        hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
        l_ch = lab[:, :, 0]
        s_ch = hsv[:, :, 1]

        k_size = max(11, min(31, int(min(h, w) * 0.025) | 1))
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_size, k_size))

        sens_norm = max(0.0, min(1.0, (sensitivity - 10.0) / 85.0))
        lum_thresh = int(round(40.0 - sens_norm * 28.0))
        sat_cap = int(round(95.0 + sens_norm * 70.0))

        mask = np.zeros((h, w), dtype=np.uint8)

        if tone in ("light", "both"):
            tophat = cv2.morphologyEx(l_ch, cv2.MORPH_TOPHAT, kernel)
            light_hit = (tophat >= lum_thresh) & (s_ch <= sat_cap) & (alpha >= 20)
            mask[light_hit] = 255

        if tone in ("dark", "both"):
            blackhat = cv2.morphologyEx(l_ch, cv2.MORPH_BLACKHAT, kernel)
            dark_hit = (blackhat >= lum_thresh) & (s_ch <= sat_cap) & (alpha >= 20)
            mask[dark_hit] = 255

        open_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, open_kernel)
        dilate_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask = cv2.dilate(mask, dilate_kernel, iterations=1)

        overlay = np.zeros((h, w, 4), dtype=np.uint8)
        overlay[mask > 0] = (1, 195, 142, 255)

        detected_pixels = int(np.count_nonzero(mask))
        total_pixels = max(1, h * w)
        elapsed = round((time.perf_counter() - started) * 1000.0, 1)

        return WatermarkMaskResult(
            mask_png_bytes=_encode_rgba_png(overlay),
            width=w,
            height=h,
            detected_pixels=detected_pixels,
            detected_percent=round((detected_pixels / total_pixels) * 100.0, 2),
            processing_time_ms=elapsed,
        )
