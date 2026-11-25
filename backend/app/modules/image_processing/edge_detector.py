"""
Phase 2 - Module 2 (Active): Automatic Die-Cut Contour Engine, Rounded Bezier Generator & 2-Layer EPS Exporter.

Supports:
- Shape modes: `en_su_forma` (organic silhouette), `circular`, `poligono_regular` (3..12 sides)
- Cut direction: `outside` (exterior bleed contour) or `inside` (interior full-bleed inset cut)
- Automatic design base-color & palette detection in CIELAB for matching die-cut borders
- Real-time interactive Bezier editing + 2-layer PostScript Level 3 EPS & SVG export
"""

from __future__ import annotations

import base64
import io
import math
from dataclasses import dataclass
from typing import Any, List, Optional, Tuple

from app.modules.image_processing.base import (
    BaseImageProcessor,
    BezierAnchor,
    ContourPoint,
    DieCutBorderCutPosition,
    DieCutBorderMode,
    DieCutDirection,
    DieCutFitMode,
    DieCutResult,
    DieCutShapeMode,
    ImageAsset,
    check_phase2_dependencies,
)
from app.modules.image_processing.enhancer import (
    _keep_main_design_components,
    compute_effective_dpi_for_item,
    remove_image_background_rgba,
    resolve_physical_size_cm,
)
from app.modules.image_processing.retouch import (
    parse_hex_color,
    rgb_to_hex,
)

PT_PER_CM: float = 72.0 / 2.54  # 28.346456692913385 PostScript points per centimeter


@dataclass(frozen=True)
class EdgeDetectionPayload:
    asset: ImageAsset
    mode: DieCutShapeMode = "en_su_forma"
    cut_direction: DieCutDirection = "outside"
    dpi: int = 300
    bleed_mm: float = 2.5
    corner_roundness: float = 0.35
    smoothing_epsilon: float = 0.004
    polygon_sides: int = 6
    polygon_rotation_deg: float = 0.0
    remove_background: bool = False
    bg_tolerance: int = 28
    merge_islands: bool = True
    join_islands: Optional[bool] = None
    border_mode: DieCutBorderMode = "none"
    border_color: Optional[str] = None
    border_width_mm: float = 2.0
    border_cut_position: DieCutBorderCutPosition = "inside_base"
    border_offset_mm: float = 1.5
    white_border_mm: float = 0.0
    target_width_cm: Optional[float] = None
    target_height_cm: Optional[float] = None
    fit_mode: DieCutFitMode = "contain_proportional"
    item: Optional[Any] = None


def detect_design_base_color(rgb, alpha) -> Tuple[Optional[str], List[str]]:
    """
    Detect the dominant base color and top palette swatches of an RGBA sticker design.

    Uses deterministic CIELAB K-Means over opaque design pixels, combining overall area
    dominance (65%) with outer-interior-band presence (35%) while skipping the outermost
    2px anti-aliased fringe. Returns `(primary_base_hex, palette_hex_list)` using exact
    per-cluster median RGB values so the detected color matches the artwork faithfully.
    """
    import cv2
    import numpy as np

    h, w = rgb.shape[:2]
    opaque = alpha >= 160
    if int(np.count_nonzero(opaque)) < 24:
        opaque = alpha >= 20
    if int(np.count_nonzero(opaque)) < 8:
        return None, []

    fg_u8 = opaque.astype(np.uint8) * 255
    dist_inside = cv2.distanceTransform(fg_u8, cv2.DIST_L2, 5)
    max_d = float(dist_inside.max())
    band_outer = max(8.0, min(max_d * 0.45, min(h, w) * 0.14))
    band_inner = 2.0 if max_d > 5.0 else 0.5
    outer_band = opaque & (dist_inside >= band_inner) & (dist_inside <= band_outer)
    if int(np.count_nonzero(outer_band)) < 16:
        outer_band = opaque

    lab_img = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)

    all_ys, all_xs = np.where(opaque)
    total_opaque = len(all_ys)
    step = max(1, total_opaque // 5000)
    s_ys = all_ys[::step]
    s_xs = all_xs[::step]

    sample_lab = lab_img[s_ys, s_xs]
    sample_rgb = rgb[s_ys, s_xs]
    sample_in_band = outer_band[s_ys, s_xs]

    q = (sample_lab // 14).astype(np.int32)
    unique_bins = len(np.unique(q[:, 0] * 65536 + q[:, 1] * 256 + q[:, 2]))
    k = max(1, min(5, unique_bins, len(sample_lab)))

    if k == 1:
        med_rgb = tuple(int(round(v)) for v in np.median(sample_rgb, axis=0))
        hx = rgb_to_hex(med_rgb)
        return hx, [hx]

    cv2.setRNGSeed(42)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 25, 1.0)
    _, labels, _ = cv2.kmeans(
        sample_lab.astype(np.float32),
        k,
        None,
        criteria,
        3,
        cv2.KMEANS_PP_CENTERS,
    )
    labels_flat = labels.ravel()
    n_samples = float(len(labels_flat))
    n_band = float(max(1, int(np.count_nonzero(sample_in_band))))

    raw_clusters: List[Tuple[float, "object", Tuple[int, int, int]]] = []
    for cid in range(k):
        sel = labels_flat == cid
        cnt = int(np.count_nonzero(sel))
        if cnt == 0:
            continue
        area_ratio = cnt / n_samples
        band_ratio = int(np.count_nonzero(sel & sample_in_band)) / n_band
        score = area_ratio * 0.65 + band_ratio * 0.35
        c_lab = np.median(sample_lab[sel], axis=0).astype(np.float32)
        c_rgb = tuple(int(round(v)) for v in np.median(sample_rgb[sel], axis=0))
        raw_clusters.append((score, c_lab, c_rgb))

    raw_clusters.sort(key=lambda item: item[0], reverse=True)

    # Deduplicate perceptually near-identical swatches (< 12 Lab units)
    deduped: List[Tuple[float, "object", Tuple[int, int, int]]] = []
    for score, c_lab, c_rgb in raw_clusters:
        merged = False
        for idx, (m_score, m_lab, m_rgb) in enumerate(deduped):
            if float(np.linalg.norm(c_lab - m_lab)) < 12.0:
                deduped[idx] = (m_score + score, m_lab, m_rgb)
                merged = True
                break
        if not merged:
            deduped.append((score, c_lab, c_rgb))

    deduped.sort(key=lambda item: item[0], reverse=True)
    palette = [rgb_to_hex(item[2]) for item in deduped[:5]]
    primary = palette[0] if palette else None
    return primary, palette


def _resolve_auto_oriented_target_cm(
    ref_w_px: float,
    ref_h_px: float,
    target_width_cm: Optional[float],
    target_height_cm: Optional[float],
    item: Optional[Any] = None,
) -> Optional[Tuple[float, float]]:
    """
    Resolve and auto-orient target physical dimensions `(width_cm, height_cm)` to match the
    aspect orientation of the design `(ref_w_px, ref_h_px)`.

    - When only `height_cm` (`height_only`) or only `width_cm` (`width_only`) is specified on `item`
      or via `target_height_cm` / `target_width_cm`, uses `resolve_physical_size_cm` to calculate
      the proportional dimension directly from `(ref_w_px, ref_h_px)`.
    - When both `width_cm` and `height_cm` (`both`) are specified and the artwork/cut-contour is
      vertical (`height > width`) while the order comes as `7x5 cm` (or `5x7 cm`), automatically
      aligns the shorter side to width and the longer side to height (and vice versa for horizontal
      artwork), avoiding shrinking or distorting the illustration.
    """
    safe_w = max(1.0, float(ref_w_px))
    safe_h = max(1.0, float(ref_h_px))

    tw = float(target_width_cm) if target_width_cm is not None and target_width_cm > 0 else None
    th = float(target_height_cm) if target_height_cm is not None and target_height_cm > 0 else None

    if tw is None and th is None and item is not None:
        resolved_from_item = resolve_physical_size_cm(item, safe_w, safe_h)
        if resolved_from_item is None:
            return None
        tw, th = resolved_from_item

    if tw is None and th is None:
        return None

    if tw is not None and th is None:
        return resolve_physical_size_cm(
            {"size_mode": "width_only", "width_cm": tw}, safe_w, safe_h
        )
    if th is not None and tw is None:
        return resolve_physical_size_cm(
            {"size_mode": "height_only", "height_cm": th}, safe_w, safe_h
        )

    assert tw is not None and th is not None
    if abs(tw - th) > 1e-4:
        lo_cm = min(tw, th)
        hi_cm = max(tw, th)
        if safe_h > safe_w * 1.02:
            return (lo_cm, hi_cm)
        if safe_w > safe_h * 1.02:
            return (hi_cm, lo_cm)

    return (tw, th)


def _build_clean_alpha_mask(
    alpha_u8,
    *,
    alpha_threshold: int = 45,
    min_area_ratio: float = 0.0005,
    reference_area: Optional[float] = None,
):
    """
    Build a strict binary silhouette mask (`0` or `255`) from an RGBA alpha channel:
    - Uses `alpha >= 45` (instead of `alpha > 0` / `alpha > 20`) to reject faint semi-transparent
      halos left by background removal or soft brushes.
    - Removes tiny connected components (`< 0.05%` of total area) so stray dust or ghost pixels
      far from the artwork never push the die-cut contour outward.
    """
    import cv2
    import numpy as np

    h, w = alpha_u8.shape[:2]
    thresh = max(1, min(254, int(alpha_threshold)))
    bin_u8 = (alpha_u8 >= thresh).astype(np.uint8)
    if int(np.count_nonzero(bin_u8)) < 16:
        bin_u8 = (alpha_u8 >= 20).astype(np.uint8)
    if int(np.count_nonzero(bin_u8)) == 0:
        return np.zeros((h, w), dtype=np.uint8)

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(bin_u8, connectivity=8)
    if num_labels <= 1:
        return np.zeros((h, w), dtype=np.uint8)

    fg_area = float(np.count_nonzero(bin_u8))
    total_ref_area = float(reference_area) if (reference_area and reference_area > 0) else float(h * w)
    min_comp_area = max(8, int(round(max(fg_area, total_ref_area) * float(min_area_ratio))))

    comp_ids: List[Tuple[int, int]] = []
    for cid in range(1, num_labels):
        area = int(stats[cid, cv2.CC_STAT_AREA])
        comp_ids.append((area, cid))

    comp_ids.sort(reverse=True)
    valid_ids = [cid for area, cid in comp_ids if area >= min_comp_area]
    if not valid_ids and comp_ids:
        valid_ids = [comp_ids[0][1]]

    return np.where(np.isin(labels, valid_ids), 255, 0).astype(np.uint8)


def _bridge_disconnected_islands_minimal(
    mask_u8,
    *,
    bridge_thickness_px: int = 3,
):
    """
    Connect separate disconnected islands in an already distance-expanded silhouette via thin
    nearest-boundary bridges WITHOUT applying `MORPH_CLOSE` (preserving concave bays faithfully).
    """
    import cv2
    import numpy as np

    bin_u8 = (mask_u8 > 127).astype(np.uint8)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(bin_u8, connectivity=8)
    if num_labels <= 2:
        return (bin_u8 * 255).astype(np.uint8)

    comp_ids = sorted(
        ((int(stats[cid, cv2.CC_STAT_AREA]), cid) for cid in range(1, num_labels)),
        reverse=True,
    )[:16]
    valid_ids = [cid for _, cid in comp_ids]

    clean_mask = np.where(np.isin(labels, valid_ids), 255, 0).astype(np.uint8)
    island_boundaries: List[np.ndarray] = []
    for cid in valid_ids:
        comp_u8 = np.where(labels == cid, 255, 0).astype(np.uint8)
        cnts, _ = cv2.findContours(comp_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            continue
        pts = np.vstack([c.reshape(-1, 2) for c in cnts]).astype(np.float32)
        step = max(1, len(pts) // 200)
        island_boundaries.append(pts[::step])

    if len(island_boundaries) <= 1:
        return clean_mask

    connected = {0}
    remaining = set(range(1, len(island_boundaries)))
    thickness = max(3, min(10, int(bridge_thickness_px)))

    while remaining:
        best_dist = float("inf")
        best_pair: Optional[Tuple[Tuple[int, int], Tuple[int, int], int]] = None
        for c_idx in connected:
            pts_a = island_boundaries[c_idx]
            for r_idx in remaining:
                pts_b = island_boundaries[r_idx]
                diff = pts_a[:, None, :] - pts_b[None, :, :]
                dist_sq = diff[:, :, 0] ** 2 + diff[:, :, 1] ** 2
                flat_min = int(np.argmin(dist_sq))
                d_val = float(math.sqrt(float(dist_sq.ravel()[flat_min])))
                if d_val < best_dist:
                    ia, ib = divmod(flat_min, len(pts_b))
                    pa = (int(round(float(pts_a[ia, 0]))), int(round(float(pts_a[ia, 1]))))
                    pb = (int(round(float(pts_b[ib, 0]))), int(round(float(pts_b[ib, 1]))))
                    best_dist = d_val
                    best_pair = (pa, pb, r_idx)

        if best_pair is None:
            break
        pa, pb, chosen_r = best_pair
        cv2.line(clean_mask, pa, pb, 255, thickness=thickness, lineType=cv2.LINE_AA)
        connected.add(chosen_r)
        remaining.remove(chosen_r)

    return (clean_mask > 127).astype(np.uint8) * 255


def _resample_closed_contour_uniform(
    raw_contour,
    *,
    step_px: float = 2.0,
) -> "object":
    """
    Resample a closed contour `(M, 1, 2)` at uniform arc-length intervals (`step_px`) before
    smoothing and `cv2.approxPolyDP` so vertices are evenly distributed without bunching or
    abrupt kinks caused by uneven raster staircase density.
    """
    import numpy as np

    pts = raw_contour.reshape(-1, 2).astype(np.float64)
    if len(pts) < 4:
        return raw_contour

    closed = np.vstack([pts, pts[0:1]])
    diffs = np.diff(closed, axis=0)
    seg_lens = np.hypot(diffs[:, 0], diffs[:, 1])

    valid_mask = seg_lens > 1e-5
    if int(np.count_nonzero(valid_mask)) < 3:
        return raw_contour

    start_pts = closed[:-1][valid_mask]
    valid_lens = seg_lens[valid_mask]
    closed_valid = np.vstack([start_pts, start_pts[0:1]])
    cum_dist = np.concatenate([[0.0], np.cumsum(valid_lens)])
    total_len = float(cum_dist[-1])

    if total_len < 6.0:
        return raw_contour

    safe_step = max(1.0, float(step_px))
    num_samples = max(16, min(1400, int(round(total_len / safe_step))))
    target_dists = np.linspace(0.0, total_len, num=num_samples, endpoint=False)

    xs = np.interp(target_dists, cum_dist, closed_valid[:, 0])
    ys = np.interp(target_dists, cum_dist, closed_valid[:, 1])
    resampled = np.column_stack([xs, ys]).reshape(-1, 1, 2).astype(np.float32)
    return resampled


def _smooth_contour_points_gaussian(
    raw_contour,
    *,
    sigma: float = 1.5,
) -> "object":
    """
    Apply a 1D circular Gaussian smoothing filter along a uniformly resampled closed contour
    `(N, 1, 2)` before `cv2.approxPolyDP` to remove sub-pixel staircase jaggies cleanly.
    """
    import cv2
    import numpy as np

    pts = raw_contour.reshape(-1, 2).astype(np.float32)
    n = len(pts)
    if n < 8 or sigma <= 0.1:
        return raw_contour

    k_half = min(n // 4, max(2, int(round(sigma * 2.5))))
    if k_half < 1:
        return raw_contour
    k_size = k_half * 2 + 1

    padded = np.pad(pts, ((k_half, k_half), (0, 0)), mode="wrap")
    xs = cv2.GaussianBlur(padded[:, 0:1], (1, k_size), sigmaX=0.0, sigmaY=sigma)
    ys = cv2.GaussianBlur(padded[:, 1:2], (1, k_size), sigmaX=0.0, sigmaY=sigma)
    smoothed = np.hstack([xs, ys])[k_half : k_half + n]
    return smoothed.reshape(-1, 1, 2).astype(np.float32)


def _points_to_rounded_bezier_anchors(
    points: List[Tuple[float, float]],
    roundness: float = 0.35,
    max_handle_ratio: float = 0.30,
) -> List[BezierAnchor]:
    """
    Convert a closed polygon into smooth cubic Bezier anchors using Centripetal Catmull-Rom
    tangents (`alpha = 0.5`) with strict handle length clamping (`<= 0.30 * segment_length`)
    so the curve follows the true silhouette faithfully without waves, overshoot, or pinches.
    """
    if len(points) < 3:
        return []

    raw_perim = sum(
        math.hypot(
            points[(i + 1) % len(points)][0] - points[i][0],
            points[(i + 1) % len(points)][1] - points[i][1],
        )
        for i in range(len(points))
    )
    min_chord = max(2.0, min(6.0, raw_perim * 0.005)) if len(points) >= 8 else 1.5

    # Prune near-duplicate / bunched consecutive vertices that could cause tangent oscillation
    filtered: List[Tuple[float, float]] = []
    for pt in points:
        rounded_pt = (round(float(pt[0]), 2), round(float(pt[1]), 2))
        if (
            not filtered
            or math.hypot(rounded_pt[0] - filtered[-1][0], rounded_pt[1] - filtered[-1][1])
            >= min_chord
        ):
            filtered.append(rounded_pt)
    if (
        len(filtered) >= 4
        and math.hypot(filtered[0][0] - filtered[-1][0], filtered[0][1] - filtered[-1][1])
        < min_chord
    ):
        filtered.pop()
    if len(filtered) >= 3:
        points = filtered
    else:
        points = [(round(float(p[0]), 2), round(float(p[1]), 2)) for p in points]

    n = len(points)
    if n < 3:
        return []

    capped_ratio = max(0.05, min(0.30, float(max_handle_ratio)))
    clamped_roundness = max(0.05, min(1.0, float(roundness)))
    base_tension = min(capped_ratio, clamped_roundness * capped_ratio)
    # Slight safety margin below 0.30 so 2-decimal coordinate rounding never exceeds 0.30 * d_seg
    safe_cap = max(0.05, capped_ratio - 0.004)
    anchors: List[BezierAnchor] = []

    for i in range(n):
        prev_pt = points[(i - 1) % n]
        curr_pt = points[i]
        next_pt = points[(i + 1) % n]

        dx_in = curr_pt[0] - prev_pt[0]
        dy_in = curr_pt[1] - prev_pt[1]
        d_prev = math.hypot(dx_in, dy_in)

        dx_out = next_pt[0] - curr_pt[0]
        dy_out = next_pt[1] - curr_pt[1]
        d_next = math.hypot(dx_out, dy_out)

        if d_prev > 1e-6 and d_next > 1e-6:
            vin_x, vin_y = dx_in / d_prev, dy_in / d_prev
            vout_x, vout_y = dx_out / d_next, dy_out / d_next

            # Centripetal Catmull-Rom weighting (alpha = 0.5) favors the shorter chord
            w_in = math.sqrt(d_next)
            w_out = math.sqrt(d_prev)
            tx = w_in * vin_x + w_out * vout_x
            ty = w_in * vin_y + w_out * vout_y
            t_len = math.hypot(tx, ty)

            if t_len > 1e-6:
                ux, uy = tx / t_len, ty / t_len
            else:
                ux, uy = vin_x, vin_y

            # Dampen handles on sharp turns/valleys to eliminate outward bulges & pinches
            cos_turn = max(-1.0, min(1.0, vin_x * vout_x + vin_y * vout_y))
            corner_scale = max(0.28, 0.5 * (1.0 + max(-0.45, cos_turn)))

            # Strictly cap each handle to <= 0.30 * segment_length
            in_len = min(d_prev * base_tension * corner_scale, d_prev * safe_cap)
            out_len = min(d_next * base_tension * corner_scale, d_next * safe_cap)

            in_x = round(curr_pt[0] - ux * in_len, 2)
            in_y = round(curr_pt[1] - uy * in_len, 2)
            out_x = round(curr_pt[0] + ux * out_len, 2)
            out_y = round(curr_pt[1] + uy * out_len, 2)

            # Guarantee exact post-rounding bound <= 0.30 * segment_length
            actual_in = math.hypot(curr_pt[0] - in_x, curr_pt[1] - in_y)
            if actual_in > d_prev * capped_ratio and actual_in > 1e-6:
                scale_in = (d_prev * safe_cap) / actual_in
                in_x = round(curr_pt[0] + (in_x - curr_pt[0]) * scale_in, 2)
                in_y = round(curr_pt[1] + (in_y - curr_pt[1]) * scale_in, 2)

            actual_out = math.hypot(out_x - curr_pt[0], out_y - curr_pt[1])
            if actual_out > d_next * capped_ratio and actual_out > 1e-6:
                scale_out = (d_next * safe_cap) / actual_out
                out_x = round(curr_pt[0] + (out_x - curr_pt[0]) * scale_out, 2)
                out_y = round(curr_pt[1] + (out_y - curr_pt[1]) * scale_out, 2)
        else:
            in_x, in_y = curr_pt
            out_x, out_y = curr_pt

        anchors.append(
            BezierAnchor(
                x=curr_pt[0],
                y=curr_pt[1],
                in_x=in_x,
                in_y=in_y,
                out_x=out_x,
                out_y=out_y,
                smooth=True,
            )
        )

    return anchors


def _circle_to_bezier_anchors(cx: float, cy: float, radius: float, segments: int = 8) -> List[BezierAnchor]:
    n = max(4, segments)
    theta = (2.0 * math.pi) / n
    kappa = (4.0 / 3.0) * math.tan(theta / 4.0) * radius

    anchors: List[BezierAnchor] = []
    for i in range(n):
        angle = -math.pi / 2.0 + i * theta
        cos_a = math.cos(angle)
        sin_a = math.sin(angle)
        x = cx + radius * cos_a
        y = cy + radius * sin_a

        tx, ty = -sin_a, cos_a
        anchors.append(
            BezierAnchor(
                x=round(x, 2),
                y=round(y, 2),
                in_x=round(x - tx * kappa, 2),
                in_y=round(y - ty * kappa, 2),
                out_x=round(x + tx * kappa, 2),
                out_y=round(y + ty * kappa, 2),
                smooth=True,
            )
        )
    return anchors


def _regular_polygon_rounded_anchors(
    cx: float,
    cy: float,
    radius: float,
    sides: int,
    rotation_deg: float,
    roundness: float,
) -> List[BezierAnchor]:
    """Build a regular polygon (3..12 sides) with smoothly rounded vertex fillets."""
    n = max(3, min(12, int(sides)))
    rot_rad = math.radians(rotation_deg - 90.0)
    if n == 4 and abs(rotation_deg) < 1e-6:
        rot_rad = math.radians(-45.0)

    verts: List[Tuple[float, float]] = []
    for i in range(n):
        angle = rot_rad + (2.0 * math.pi * i) / n
        verts.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))

    corner_frac = max(0.06, min(0.42, float(roundness) * 0.42))
    anchors: List[BezierAnchor] = []

    for i in range(n):
        p_prev = verts[(i - 1) % n]
        p_curr = verts[i]
        p_next = verts[(i + 1) % n]

        e_x = p_curr[0] + (p_prev[0] - p_curr[0]) * corner_frac
        e_y = p_curr[1] + (p_prev[1] - p_curr[1]) * corner_frac

        l_x = p_curr[0] + (p_next[0] - p_curr[0]) * corner_frac
        l_y = p_curr[1] + (p_next[1] - p_curr[1]) * corner_frac

        k = 0.552
        c1_x = e_x + (p_curr[0] - e_x) * k
        c1_y = e_y + (p_curr[1] - e_y) * k

        c2_x = l_x + (p_curr[0] - l_x) * k
        c2_y = l_y + (p_curr[1] - l_y) * k

        anchors.append(
            BezierAnchor(
                x=round(e_x, 2),
                y=round(e_y, 2),
                in_x=round(e_x, 2),
                in_y=round(e_y, 2),
                out_x=round(c1_x, 2),
                out_y=round(c1_y, 2),
                smooth=True,
            )
        )
        anchors.append(
            BezierAnchor(
                x=round(l_x, 2),
                y=round(l_y, 2),
                in_x=round(c2_x, 2),
                in_y=round(c2_y, 2),
                out_x=round(l_x, 2),
                out_y=round(l_y, 2),
                smooth=True,
            )
        )

    return anchors


def _find_inscribed_polygon_radius(
    dist_map,
    cx: float,
    cy: float,
    sides: int,
    rotation_deg: float,
    inset_px: float,
    fallback_radius: float,
) -> float:
    """
    Binary-search the largest regular polygon circumradius centered at (cx, cy) whose
    vertices and edge midpoints all sit at least `inset_px` inside the artwork mask.
    """
    h, w = dist_map.shape[:2]
    n = max(3, min(12, int(sides)))
    rot_rad = math.radians(rotation_deg - 90.0)
    if n == 4 and abs(rotation_deg) < 1e-6:
        rot_rad = math.radians(-45.0)

    # Check if center is inside foreground; if hollow, fall back cleanly
    cy_i = max(0, min(h - 1, int(round(cy))))
    cx_i = max(0, min(w - 1, int(round(cx))))
    if float(dist_map[cy_i, cx_i]) < max(8.0, inset_px):
        return max(12.0, fallback_radius)

    unit_verts = [
        (math.cos(rot_rad + (2.0 * math.pi * i) / n), math.sin(rot_rad + (2.0 * math.pi * i) / n))
        for i in range(n)
    ]
    # Sample vertices + quarter/half edge points so edges never poke outside
    sample_dirs: List[Tuple[float, float]] = []
    for i in range(n):
        v0 = unit_verts[i]
        v1 = unit_verts[(i + 1) % n]
        for t in (0.0, 0.25, 0.5, 0.75):
            sample_dirs.append((v0[0] + (v1[0] - v0[0]) * t, v0[1] + (v1[1] - v0[1]) * t))

    lo = 10.0
    hi = float(max(w, h))
    for _ in range(16):
        mid = 0.5 * (lo + hi)
        fits = True
        for ux, uy in sample_dirs:
            px = int(round(cx + mid * ux))
            py = int(round(cy + mid * uy))
            if px < 0 or px >= w or py < 0 or py >= h:
                fits = False
                break
            if float(dist_map[py, px]) < inset_px:
                fits = False
                break
        if fits:
            lo = mid
        else:
            hi = mid

    return max(12.0, lo)


def anchors_to_svg_path_d(anchors: List[BezierAnchor]) -> str:
    if len(anchors) < 3:
        return ""
    first = anchors[0]
    parts = [f"M {first.x:.2f} {first.y:.2f}"]
    n = len(anchors)
    for i in range(n):
        curr = anchors[i]
        nxt = anchors[(i + 1) % n]
        parts.append(
            f"C {curr.out_x:.2f} {curr.out_y:.2f}, {nxt.in_x:.2f} {nxt.in_y:.2f}, {nxt.x:.2f} {nxt.y:.2f}"
        )
    parts.append("Z")
    return " ".join(parts)


def _sample_bezier_polygon(anchors: List[BezierAnchor], steps_per_seg: int = 24) -> List[Tuple[float, float]]:
    """Sample a closed cubic Bezier contour into dense polygon points for anti-aliased rendering."""
    pts: List[Tuple[float, float]] = []
    n = len(anchors)
    if n < 3:
        return pts

    for i in range(n):
        a = anchors[i]
        b = anchors[(i + 1) % n]
        for s in range(steps_per_seg):
            t = s / float(steps_per_seg)
            mt = 1.0 - t
            mt2 = mt * mt
            t2 = t * t
            x = mt2 * mt * a.x + 3.0 * mt2 * t * a.out_x + 3.0 * mt * t2 * b.in_x + t2 * t * b.x
            y = mt2 * mt * a.y + 3.0 * mt2 * t * a.out_y + 3.0 * mt * t2 * b.in_y + t2 * t * b.y
            pts.append((x, y))
    return pts


def _compute_cut_contour_bbox_px(
    anchors: List[BezierAnchor],
    fallback_w: int,
    fallback_h: int,
) -> Tuple[float, float, float, float]:
    """
    Compute the exact axis-aligned bounding box `(min_x, min_y, width_px, height_px)` of the
    final `CutContour` cubic Bezier path (sampling curve extrema, not just control points).
    """
    if len(anchors) < 3:
        return (0.0, 0.0, max(1.0, float(fallback_w)), max(1.0, float(fallback_h)))

    sampled = _sample_bezier_polygon(anchors, steps_per_seg=32)
    if not sampled:
        xs = [a.x for a in anchors]
        ys = [a.y for a in anchors]
    else:
        xs = [p[0] for p in sampled]
        ys = [p[1] for p in sampled]

    min_x = float(min(xs))
    max_x = float(max(xs))
    min_y = float(min(ys))
    max_y = float(max(ys))
    return (min_x, min_y, max(1.0, max_x - min_x), max(1.0, max_y - min_y))


def _segment_opaque_perimeter_subject(
    rgb,
    alpha,
    *,
    bg_tolerance: int = 28,
    force_remove: bool = False,
) -> Tuple["object", "object", bool]:
    """
    Check if the image perimeter is opaque (> 90% of perimeter pixels with `alpha >= 250`).
    When the image has no real transparency (e.g., solid black, white, or colored backdrop),
    automatically detect the uniform perimeter/corner background and isolate the subject
    using `rembg` (`ai_rembg` if available) or LAB border flood-fill + GrabCut refinement
    so `en_su_forma` NEVER traces the 4-corner outer canvas frame.
    """
    import cv2
    import numpy as np

    h, w = rgb.shape[:2]
    b = max(2, min(6, min(h, w) // 40))
    perim_mask = np.zeros((h, w), dtype=bool)
    perim_mask[:b, :] = True
    perim_mask[-b:, :] = True
    perim_mask[:, :b] = True
    perim_mask[:, -b:] = True

    perim_opaque_ratio = float(np.mean(alpha[perim_mask] >= 250))
    if not force_remove and perim_opaque_ratio <= 0.90:
        return rgb, alpha, False

    # Sample 4 corners & perimeter in CIELAB to check backdrop uniformity
    c_sz = max(2, min(10, min(h, w) // 16))
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    corners_lab = np.concatenate(
        [
            lab[:c_sz, :c_sz].reshape(-1, 3),
            lab[:c_sz, -c_sz:].reshape(-1, 3),
            lab[-c_sz:, :c_sz].reshape(-1, 3),
            lab[-c_sz:, -c_sz:].reshape(-1, 3),
        ],
        axis=0,
    )
    corner_med = np.median(corners_lab, axis=0).astype(np.float32)
    perim_pts = lab[perim_mask]
    perim_dists = np.linalg.norm(perim_pts - corner_med[None, :], axis=1)
    uniform_perim = float(np.percentile(perim_dists, 75)) <= 32.0

    if not force_remove and not uniform_perim and perim_opaque_ratio <= 0.90:
        return rgb, alpha, False

    deps = check_phase2_dependencies()
    preferred_mode = "ai_rembg" if (deps.get("rembg") and deps.get("onnxruntime")) else "smart_subject"
    seg_rgb, seg_alpha = remove_image_background_rgba(
        rgb,
        alpha,
        mode=preferred_mode,
        tolerance=bg_tolerance,
        feather=1,
    )

    # Verify the segmentation actually stripped the outer perimeter frame and didn't leave the full rectangle
    rem_perim_opaque = float(np.mean(seg_alpha[perim_mask] > 20))
    rem_total_fg = float(np.mean(seg_alpha > 20))

    if rem_perim_opaque > 0.70 or rem_total_fg > 0.93 or rem_total_fg < 0.005:
        # Adaptive corner-seeded LAB flood-fill + GrabCut fallback for high-contrast/dark/black backdrops
        dist_all = np.linalg.norm(lab - corner_med[None, None, :], axis=2)
        p90_perim = float(np.percentile(perim_dists, 90))
        adaptive_thresh = max(float(bg_tolerance) * 1.25, p90_perim + 10.0, 22.0)

        cand_bg = (dist_all <= adaptive_thresh).astype(np.uint8)
        _, cc_labels = cv2.connectedComponents(cand_bg, connectivity=4)
        border_ids = set(np.unique(cc_labels[0, :]).tolist())
        border_ids.update(np.unique(cc_labels[-1, :]).tolist())
        border_ids.update(np.unique(cc_labels[:, 0]).tolist())
        border_ids.update(np.unique(cc_labels[:, -1]).tolist())
        border_ids.discard(0)

        border_bg = np.isin(cc_labels, list(border_ids))
        fg_u8 = np.where(border_bg, 0, 255).astype(np.uint8)
        # Clear 1px outer frame to prevent border-clinging rectangle contours
        fg_u8[0, :] = 0
        fg_u8[-1, :] = 0
        fg_u8[:, 0] = 0
        fg_u8[:, -1] = 0
        fg_u8 = _keep_main_design_components(fg_u8)

        if int(np.count_nonzero(fg_u8)) >= 24:
            k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
            fg_u8 = cv2.morphologyEx(fg_u8, cv2.MORPH_OPEN, k3, iterations=1)
            fg_u8 = cv2.morphologyEx(fg_u8, cv2.MORPH_CLOSE, k3, iterations=1)
            seg_alpha = np.minimum(alpha, fg_u8).astype(np.uint8)

    return seg_rgb, seg_alpha, True


def composite_border_onto_artwork(
    artwork_png_bytes: bytes,
    anchors: List[BezierAnchor],
    *,
    width_px: int,
    height_px: int,
    border_color: Optional[str],
    cut_direction: DieCutDirection = "outside",
    border_width_mm: float = 2.0,
    border_cut_position: DieCutBorderCutPosition = "inside_base",
    border_offset_mm: float = 1.5,
    dpi: int = 300,
) -> bytes:
    """
    Composite a smooth, anti-aliased colored die-cut base border onto Capa 1 artwork.

    - `border_cut_position == "inside_base"` (recommended print-shop default):
      The colored base expands OUTWARD beyond the CutContour by `border_offset_mm` so the
      plotter blade cuts cleanly INSIDE the colored base (zero white edge slivers!).
    - `border_cut_position == "outside_base"`:
      The colored base is shrunk INWARD inside the CutContour by `border_offset_mm` so the
      CutContour runs OUTSIDE the colored base border.
    """
    rgb_tuple = parse_hex_color(border_color)
    if rgb_tuple is None or len(anchors) < 3:
        return artwork_png_bytes

    import cv2
    import numpy as np
    from PIL import Image

    pil_rgba = Image.open(io.BytesIO(artwork_png_bytes)).convert("RGBA")
    if pil_rgba.size != (width_px, height_px):
        pil_rgba = pil_rgba.resize((width_px, height_px), Image.Resampling.LANCZOS)

    art = np.array(pil_rgba, dtype=np.float32)
    art_rgb = art[:, :, :3]
    art_a = art[:, :, 3:4] / 255.0

    # 2x supersampled anti-aliased polygon mask from exact cubic Bezier curve
    ss = 2
    pts = _sample_bezier_polygon(anchors, steps_per_seg=24)
    poly_ss = np.array([[int(round(x * ss)), int(round(y * ss))] for x, y in pts], dtype=np.int32)
    mask_ss = np.zeros((height_px * ss, width_px * ss), dtype=np.uint8)
    cv2.fillPoly(mask_ss, [poly_ss], 255, lineType=cv2.LINE_AA)

    border_rgb_arr = np.array(rgb_tuple, dtype=np.float32)[None, None, :]
    offset_px = max(0.0, (max(0.0, float(border_offset_mm)) / 25.4) * dpi)
    offset_ss = offset_px * ss

    if border_cut_position == "inside_base":
        # Expand base OUTWARD past CutContour so the blade cuts INSIDE the colored base
        inv_mask = np.where(mask_ss > 127, 0, 255).astype(np.uint8)
        dist_out = cv2.distanceTransform(inv_mask, cv2.DIST_L2, 5)
        expand_r = max(1.0, offset_ss)
        base_ss = np.where(dist_out <= expand_r, 255, 0).astype(np.uint8)
        base_ss = cv2.GaussianBlur(base_ss, (3, 3), 0)
    else:
        # Shrink base INWARD inside CutContour so the blade cuts OUTSIDE the colored base
        if offset_ss >= 1.0:
            dist_in = cv2.distanceTransform((mask_ss > 127).astype(np.uint8) * 255, cv2.DIST_L2, 5)
            max_d = float(dist_in.max())
            safe_shrink = min(offset_ss, max(0.0, max_d * 0.45))
            base_ss = np.where(dist_in >= safe_shrink, 255, 0).astype(np.uint8)
            base_ss = cv2.GaussianBlur(base_ss, (3, 3), 0)
        else:
            base_ss = mask_ss

    fill_alpha = (
        cv2.resize(base_ss, (width_px, height_px), interpolation=cv2.INTER_AREA).astype(np.float32)
        / 255.0
    )
    fill_a = fill_alpha[:, :, None]

    if cut_direction == "outside":
        # Porter-Duff source-over: artwork ON TOP OF colored base backing
        out_a = art_a + fill_a * (1.0 - art_a)
        safe_out_a = np.maximum(out_a, 1e-6)
        out_rgb = (art_rgb * art_a + border_rgb_arr * fill_a * (1.0 - art_a)) / safe_out_a
        out_rgb = np.where(out_a > 1e-4, out_rgb, 0.0)
    else:
        # Step 1: Fill any transparent interior behind artwork inside base
        base_a = art_a + fill_a * (1.0 - art_a)
        safe_base_a = np.maximum(base_a, 1e-6)
        base_rgb = (art_rgb * art_a + border_rgb_arr * fill_a * (1.0 - art_a)) / safe_base_a

        # Step 2: Crisp colored border band along the contour (straddling CutContour if inside_base,
        # or strictly inset inside CutContour if outside_base)
        border_px = max(2, int(round((max(0.5, float(border_width_mm)) / 25.4) * dpi)))
        stroke_ss = np.zeros((height_px * ss, width_px * ss), dtype=np.uint8)
        cv2.polylines(
            stroke_ss,
            [poly_ss],
            isClosed=True,
            color=255,
            thickness=max(2, border_px * 2 * ss),
            lineType=cv2.LINE_AA,
        )
        frame_clip = base_ss if border_cut_position == "outside_base" else cv2.bitwise_or(mask_ss, base_ss)
        inner_frame_ss = cv2.bitwise_and(stroke_ss, frame_clip)
        frame_a = (
            cv2.resize(inner_frame_ss, (width_px, height_px), interpolation=cv2.INTER_AREA).astype(
                np.float32
            )
            / 255.0
        )[:, :, None]

        out_a = frame_a + base_a * (1.0 - frame_a)
        safe_out_a = np.maximum(out_a, 1e-6)
        out_rgb = (border_rgb_arr * frame_a + base_rgb * base_a * (1.0 - frame_a)) / safe_out_a
        out_rgb = np.where(out_a > 1e-4, out_rgb, 0.0)

    out_rgba = np.dstack(
        [
            np.rint(out_rgb).clip(0, 255).astype(np.uint8),
            np.rint(out_a * 255.0).clip(0, 255).astype(np.uint8),
        ]
    )
    buf = io.BytesIO()
    Image.fromarray(out_rgba, mode="RGBA").save(buf, format="PNG", dpi=(dpi, dpi), optimize=True)
    return buf.getvalue()


class DieCutEdgeDetectorService(BaseImageProcessor[EdgeDetectionPayload, DieCutResult]):
    """Detects sticker contour silhouettes and exports 2-layer print/cut EPS & SVG files."""

    module_name = "die_cut_edge_detector"

    def is_available(self) -> bool:
        deps = check_phase2_dependencies()
        return deps["opencv"] and deps["numpy"] and deps["pillow"]

    async def process(self, payload: EdgeDetectionPayload) -> DieCutResult:
        if not self.is_available():
            raise RuntimeError("OpenCV, NumPy y Pillow son requeridos para el motor de troquelado.")

        if payload.asset.content_type == "image/svg+xml" or payload.asset.filename.lower().endswith(".svg"):
            raise ValueError(
                "El troquelador opera sobre imágenes raster PNG/JPG/WEBP. "
                "Sube un PNG transparente o procesa primero la imagen en Calidad."
            )

        return self._detect_die_cut(payload)

    def _detect_die_cut(self, payload: EdgeDetectionPayload) -> DieCutResult:
        import cv2
        import numpy as np
        from PIL import Image, ImageOps

        try:
            pil_img = Image.open(io.BytesIO(payload.asset.content))
            pil_img = ImageOps.exif_transpose(pil_img)
            pil_rgba = pil_img.convert("RGBA")
        except Exception as exc:
            raise ValueError("No se pudo abrir la imagen para generar el troquel.") from exc

        rgba = np.array(pil_rgba, dtype=np.uint8)
        rgb = rgba[:, :, :3]
        alpha = rgba[:, :, 3]
        orig_h, orig_w = rgb.shape[:2]

        bg_removed = False
        if payload.mode == "en_su_forma" or payload.remove_background:
            rgb, alpha, bg_removed = _segment_opaque_perimeter_subject(
                rgb,
                alpha,
                bg_tolerance=payload.bg_tolerance,
                force_remove=bool(payload.remove_background),
            )

        # Detect the artwork's dominant base color + top 5 palette swatches
        detected_base_color, palette_colors = detect_design_base_color(rgb, alpha)

        resolved_border_color: Optional[str] = None
        if payload.border_mode == "base_color":
            resolved_border_color = detected_base_color
        elif payload.border_mode == "white":
            resolved_border_color = "#FFFFFF"
        elif payload.border_mode == "custom":
            parsed = parse_hex_color(payload.border_color)
            resolved_border_color = rgb_to_hex(parsed) if parsed else detected_base_color

        dpi = max(72, min(1200, int(payload.dpi)))
        bleed_mm = max(0.0, float(payload.bleed_mm))
        white_border_mm = max(0.0, min(10.0, float(payload.white_border_mm)))
        join_islands = (
            bool(payload.join_islands)
            if payload.join_islands is not None
            else bool(payload.merge_islands)
        )

        # Strict alpha cleanup (`alpha >= 45` + prune tiny components < 0.05% of total area)
        clean_orig_mask = _build_clean_alpha_mask(
            alpha,
            alpha_threshold=45,
            min_area_ratio=0.0005,
            reference_area=float(orig_w * orig_h),
        )
        subj_ys, subj_xs = np.where(clean_orig_mask > 0)
        if len(subj_xs) >= 8:
            subj_w_px = max(1.0, float(int(subj_xs.max()) - int(subj_xs.min()) + 1))
            subj_h_px = max(1.0, float(int(subj_ys.max()) - int(subj_ys.min()) + 1))
        else:
            subj_w_px = float(orig_w)
            subj_h_px = float(orig_h)

        pre_oriented_target = _resolve_auto_oriented_target_cm(
            subj_w_px,
            subj_h_px,
            payload.target_width_cm,
            payload.target_height_cm,
            item=payload.item,
        )
        total_outward_mm = (bleed_mm if payload.cut_direction == "outside" else 0.0) + white_border_mm

        if pre_oriented_target is not None:
            tw_mm = pre_oriented_target[0] * 10.0
            th_mm = pre_oriented_target[1] * 10.0
            net_w_mm = max(4.0, tw_mm - 2.0 * total_outward_mm)
            net_h_mm = max(4.0, th_mm - 2.0 * total_outward_mm)
            px_per_mm_x = subj_w_px / net_w_mm
            px_per_mm_y = subj_h_px / net_h_mm
            if payload.fit_mode == "exact_stretch":
                raw_px_per_mm = 0.5 * (px_per_mm_x + px_per_mm_y)
            else:
                raw_px_per_mm = max(px_per_mm_x, px_per_mm_y)
        else:
            raw_px_per_mm = dpi / 25.4

        raw_px_per_mm = max(1.0, float(raw_px_per_mm))

        if bleed_mm <= 0.0:
            bleed_px = 0
        else:
            bleed_px = max(1, int(round(bleed_mm * raw_px_per_mm)))
            bleed_px = min(bleed_px, max(12, min(orig_w, orig_h) // 3))

        if white_border_mm <= 0.0:
            white_border_px = 0
        else:
            white_border_px = max(1, int(round(white_border_mm * raw_px_per_mm)))
            white_border_px = min(white_border_px, max(12, min(orig_w, orig_h) // 2))

        extra_base_pad = max(18, min(min(orig_w, orig_h) // 4, int(round(3.5 * raw_px_per_mm))))
        if payload.cut_direction == "outside":
            pad = bleed_px + white_border_px + extra_base_pad
        else:
            pad = max(16, white_border_px + extra_base_pad // 2)

        canvas_w = orig_w + 2 * pad
        canvas_h = orig_h + 2 * pad

        padded_rgb = np.zeros((canvas_h, canvas_w, 3), dtype=np.uint8)
        padded_alpha = np.zeros((canvas_h, canvas_w), dtype=np.uint8)
        padded_rgb[pad : pad + orig_h, pad : pad + orig_w] = rgb
        padded_alpha[pad : pad + orig_h, pad : pad + orig_w] = alpha

        base_fg_mask = np.zeros((canvas_h, canvas_w), dtype=np.uint8)
        if int(np.count_nonzero(clean_orig_mask)) >= 16:
            base_fg_mask[pad : pad + orig_h, pad : pad + orig_w] = clean_orig_mask
        else:
            base_fg_mask[pad : pad + orig_h, pad : pad + orig_w] = 255

        # Single exact Euclidean Distance Transform from the clean artwork mask (no morphological close)
        inv_base_fg = np.where(base_fg_mask > 127, 0, 255).astype(np.uint8)
        dist_from_art = cv2.distanceTransform(inv_base_fg, cv2.DIST_L2, 5)

        # Optional white sticker margin computed strictly via `cv2.distanceTransform`
        if white_border_px > 0:
            dilated_white = np.where(dist_from_art <= float(white_border_px), 255, 0).astype(
                np.uint8
            )
            smooth_white = cv2.GaussianBlur(dilated_white, (3, 3), 0)

            art_a = (padded_alpha.astype(np.float32) / 255.0)[:, :, None]
            wb_a = (smooth_white.astype(np.float32) / 255.0)[:, :, None]
            out_a = art_a + wb_a * (1.0 - art_a)
            safe_out_a = np.maximum(out_a, 1e-6)
            out_rgb = (
                padded_rgb.astype(np.float32) * art_a + 255.0 * wb_a * (1.0 - art_a)
            ) / safe_out_a
            out_rgb = np.where(out_a > 1e-4, out_rgb, 0.0)

            padded_rgb = np.rint(out_rgb).clip(0, 255).astype(np.uint8)
            padded_alpha = np.rint(out_a[:, :, 0] * 255.0).clip(0, 255).astype(np.uint8)
            fg_mask = dilated_white
        else:
            fg_mask = base_fg_mask

        ys, xs = np.where(fg_mask > 0)
        x_min, x_max = int(xs.min()), int(xs.max())
        y_min, y_max = int(ys.min()), int(ys.max())
        cx = (x_min + x_max) / 2.0
        cy = (y_min + y_max) / 2.0
        bw = max(1.0, float(x_max - x_min))
        bh = max(1.0, float(y_max - y_min))

        # Exact Euclidean distance transform inside foreground for clean inward cuts
        dist_map = cv2.distanceTransform(fg_mask, cv2.DIST_L2, 5)
        max_inscribed = float(dist_map.max())

        if payload.mode == "circular":
            if payload.cut_direction == "inside":
                r_center = float(dist_map[int(round(cy)), int(round(cx))])
                base_r = r_center if r_center >= 16.0 else min(bw, bh) / 2.0
                safe_inset = min(float(bleed_px), max(0.0, base_r * 0.65))
                radius = max(10.0, base_r - safe_inset)
                anchors = _circle_to_bezier_anchors(cx, cy, radius, segments=8)
            else:
                dists = np.hypot(xs.astype(np.float32) - cx, ys.astype(np.float32) - cy)
                radius = float(np.max(dists)) + bleed_px
                radius = min(radius, min(cx, cy, canvas_w - cx, canvas_h - cy) - 2.0)
                anchors = _circle_to_bezier_anchors(cx, cy, max(10.0, radius), segments=8)

        elif payload.mode == "poligono_regular":
            sides = max(3, min(12, int(payload.polygon_sides)))
            if payload.cut_direction == "inside":
                safe_inset = min(float(bleed_px), max(0.0, max_inscribed * 0.62))
                fallback_r = max(12.0, min(bw, bh) / 2.0 - safe_inset)
                final_r = _find_inscribed_polygon_radius(
                    dist_map,
                    cx,
                    cy,
                    sides=sides,
                    rotation_deg=payload.polygon_rotation_deg,
                    inset_px=max(1.0, safe_inset),
                    fallback_radius=fallback_r,
                )
            else:
                dists = np.hypot(xs.astype(np.float32) - cx, ys.astype(np.float32) - cy)
                inscribed_r = float(np.max(dists)) + bleed_px
                circum_r = inscribed_r / max(0.5, math.cos(math.pi / sides))
                max_r = min(cx, cy, canvas_w - cx, canvas_h - cy) - 2.0
                final_r = min(circum_r, max_r)

            anchors = _regular_polygon_rounded_anchors(
                cx,
                cy,
                max(12.0, final_r),
                sides=sides,
                rotation_deg=payload.polygon_rotation_deg,
                roundness=max(0.1, payload.corner_roundness),
            )

        else:
            # Mode: "en_su_forma" (organic silhouette contour)
            if payload.cut_direction == "inside":
                safe_inset = min(float(bleed_px), max(1.0, max_inscribed * 0.65))
                if safe_inset <= 0.5:
                    target_mask = fg_mask.copy()
                else:
                    target_mask = (dist_map >= safe_inset).astype(np.uint8) * 255
                    while int(np.count_nonzero(target_mask)) < 64 and safe_inset > 1.0:
                        safe_inset *= 0.65
                        target_mask = (dist_map >= safe_inset).astype(np.uint8) * 255
                    if int(np.count_nonzero(target_mask)) < 32:
                        target_mask = fg_mask.copy()

                smooth_mask = cv2.GaussianBlur(target_mask, (3, 3), 0.75)
                _, clean_mask = cv2.threshold(smooth_mask, 127, 255, cv2.THRESH_BINARY)
            else:
                # True uniform Euclidean distance (`cv2.distanceTransform`) from clean artwork mask
                # with ZERO exaggerated morphological closing (`MORPH_CLOSE`) so concavities stay faithful
                total_offset_px = float(white_border_px + bleed_px)
                if total_offset_px > 0.0:
                    expanded = np.where(dist_from_art <= total_offset_px, 255, 0).astype(np.uint8)
                else:
                    expanded = base_fg_mask.copy()

                if join_islands:
                    expanded = _bridge_disconnected_islands_minimal(
                        expanded,
                        bridge_thickness_px=max(3, int(round(min(8.0, max(3.0, total_offset_px * 0.5))))),
                    )

                smooth_mask = cv2.GaussianBlur(expanded, (3, 3), 0.75)
                _, clean_mask = cv2.threshold(smooth_mask, 127, 255, cv2.THRESH_BINARY)

            contours, _ = cv2.findContours(clean_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            if not contours:
                fallback_r = (
                    max(10.0, min(bw, bh) / 2.0 - bleed_px)
                    if payload.cut_direction == "inside"
                    else max(bw, bh) / 2.0 + bleed_px
                )
                anchors = _circle_to_bezier_anchors(cx, cy, fallback_r)
            else:
                largest = max(contours, key=cv2.contourArea)
                raw_perim = max(1.0, float(cv2.arcLength(largest, True)))

                # 1. Uniform arc-length resampling before approxPolyDP and tangent calculation
                uniform_step = max(1.5, min(3.5, raw_perim / 360.0))
                uniform_contour = _resample_closed_contour_uniform(largest, step_px=uniform_step)

                # 2. Gentle arc-length Gaussian filter to remove 1px raster steps evenly
                smoothed_contour = _smooth_contour_points_gaussian(uniform_contour, sigma=1.5)

                # 3. Polygon simplification (`approxPolyDP`) over uniformly spaced contour
                perimeter = max(1.0, float(cv2.arcLength(smoothed_contour, True)))
                eps = max(0.001, min(0.03, float(payload.smoothing_epsilon))) * perimeter
                approx = cv2.approxPolyDP(smoothed_contour, eps, True)

                if len(approx) > 56:
                    eps2 = eps * (len(approx) / 42.0)
                    approx = cv2.approxPolyDP(smoothed_contour, eps2, True)
                elif len(approx) < 6:
                    eps2 = max(0.6, eps * 0.4)
                    approx = cv2.approxPolyDP(smoothed_contour, eps2, True)

                pts = [(float(pt[0][0]), float(pt[0][1])) for pt in approx]
                anchors = _points_to_rounded_bezier_anchors(
                    pts,
                    roundness=max(0.15, payload.corner_roundness),
                    max_handle_ratio=0.30,
                )

        # Compute exact final CutContour bounding box & physical metrics
        _, _, cut_w_px, cut_h_px = _compute_cut_contour_bbox_px(anchors, canvas_w, canvas_h)
        oriented_target = _resolve_auto_oriented_target_cm(
            orig_w,
            orig_h,
            payload.target_width_cm,
            payload.target_height_cm,
            item=payload.item,
        )

        if oriented_target is not None:
            aligned_w_cm, aligned_h_cm = oriented_target
            if payload.fit_mode == "exact_stretch":
                px_per_cm_x = cut_w_px / aligned_w_cm
                px_per_cm_y = cut_h_px / aligned_h_cm
                eff_px_per_mm = round(0.5 * (px_per_cm_x + px_per_cm_y) / 10.0, 4)
                cut_w_cm = round(aligned_w_cm, 2)
                cut_h_cm = round(aligned_h_cm, 2)
            else:
                cm_per_px = min(aligned_w_cm / cut_w_px, aligned_h_cm / cut_h_px)
                eff_px_per_mm = round(1.0 / (cm_per_px * 10.0), 4)
                cut_w_cm = round(cut_w_px * cm_per_px, 2)
                cut_h_cm = round(cut_h_px * cm_per_px, 2)
            phys_w_cm = round(aligned_w_cm, 2)
            phys_h_cm = round(aligned_h_cm, 2)
        else:
            eff_px_per_mm = round(dpi / 25.4, 4)
            cut_w_cm = round((cut_w_px / eff_px_per_mm) / 10.0, 2)
            cut_h_cm = round((cut_h_px / eff_px_per_mm) / 10.0, 2)
            phys_w_cm = round((canvas_w / dpi) * 2.54, 2)
            phys_h_cm = round((canvas_h / dpi) * 2.54, 2)

        out_rgba = np.dstack([padded_rgb, padded_alpha])
        out_pil = Image.fromarray(out_rgba, mode="RGBA")
        png_buf = io.BytesIO()
        out_pil.save(png_buf, format="PNG", dpi=(dpi, dpi), optimize=True)
        artwork_png_bytes = png_buf.getvalue()

        path_d = anchors_to_svg_path_d(anchors)
        svg_str = self.export_two_layer_svg(
            artwork_png_bytes,
            anchors,
            width_px=canvas_w,
            height_px=canvas_h,
            dpi=dpi,
            border_color=resolved_border_color,
            cut_direction=payload.cut_direction,
            border_width_mm=payload.border_width_mm,
            border_cut_position=payload.border_cut_position,
            border_offset_mm=payload.border_offset_mm,
            target_width_cm=oriented_target[0] if oriented_target else None,
            target_height_cm=oriented_target[1] if oriented_target else None,
            fit_mode=payload.fit_mode,
        ).decode("utf-8")

        return DieCutResult(
            mode=payload.mode,
            image_width=canvas_w,
            image_height=canvas_h,
            dpi=dpi,
            bleed_mm=bleed_mm,
            cut_path_d=path_d,
            cut_path_svg=svg_str,
            bounding_box_px=(x_min, y_min, int(bw), int(bh)),
            anchors=anchors,
            contour_points=[ContourPoint(x=a.x, y=a.y) for a in anchors],
            artwork_png_bytes=artwork_png_bytes,
            background_removed=bg_removed,
            cut_direction=payload.cut_direction,
            border_mode=payload.border_mode,
            border_color=resolved_border_color,
            border_cut_position=payload.border_cut_position,
            detected_base_color=detected_base_color,
            palette_colors=palette_colors,
            white_border_mm=white_border_mm,
            source_width=orig_w,
            source_height=orig_h,
            physical_width_cm=phys_w_cm,
            physical_height_cm=phys_h_cm,
            cut_width_cm=cut_w_cm,
            cut_height_cm=cut_h_cm,
            effective_px_per_mm=eff_px_per_mm,
            target_width_cm=oriented_target[0] if oriented_target else None,
            target_height_cm=oriented_target[1] if oriented_target else None,
            fit_mode=payload.fit_mode,
        )

    def export_two_layer_svg(
        self,
        artwork_png_bytes: bytes,
        anchors: List[BezierAnchor],
        *,
        width_px: int,
        height_px: int,
        dpi: int = 300,
        border_color: Optional[str] = None,
        cut_direction: DieCutDirection = "outside",
        border_width_mm: float = 2.0,
        border_cut_position: DieCutBorderCutPosition = "inside_base",
        border_offset_mm: float = 1.5,
        cut_stroke_width_pt: float = 0.5,
        target_width_cm: Optional[float] = None,
        target_height_cm: Optional[float] = None,
        fit_mode: DieCutFitMode = "contain_proportional",
        item: Optional[Any] = None,
    ) -> bytes:
        cut_x0, cut_y0, cut_w_px, cut_h_px = _compute_cut_contour_bbox_px(
            anchors, width_px, height_px
        )
        oriented_target = _resolve_auto_oriented_target_cm(
            cut_w_px, cut_h_px, target_width_cm, target_height_cm, item=item
        )

        if oriented_target is not None:
            doc_w_cm, doc_h_cm = oriented_target
            cut_cx = cut_x0 + cut_w_px * 0.5
            cut_cy = cut_y0 + cut_h_px * 0.5
            if fit_mode == "exact_stretch":
                vb_x, vb_y, vb_w, vb_h = cut_x0, cut_y0, cut_w_px, cut_h_px
                preserve_attr = ' preserveAspectRatio="none"'
                eff_px_per_mm = 0.5 * (
                    (cut_w_px / (doc_w_cm * 10.0)) + (cut_h_px / (doc_h_cm * 10.0))
                )
            else:
                cm_per_px = min(doc_w_cm / cut_w_px, doc_h_cm / cut_h_px)
                vb_w = doc_w_cm / cm_per_px
                vb_h = doc_h_cm / cm_per_px
                vb_x = cut_cx - vb_w * 0.5
                vb_y = cut_cy - vb_h * 0.5
                preserve_attr = ""
                eff_px_per_mm = 1.0 / (cm_per_px * 10.0)
            size_attr = f'width="{doc_w_cm:.2f}cm" height="{doc_h_cm:.2f}cm"'
            viewbox_attr = f'viewBox="{vb_x:.2f} {vb_y:.2f} {vb_w:.2f} {vb_h:.2f}"{preserve_attr}'
        else:
            doc_w_cm = round((width_px / dpi) * 2.54, 2)
            doc_h_cm = round((height_px / dpi) * 2.54, 2)
            eff_px_per_mm = dpi / 25.4
            size_attr = f'width="{doc_w_cm}cm" height="{doc_h_cm}cm"'
            viewbox_attr = f'viewBox="0 0 {width_px} {height_px}"'

        b64 = base64.b64encode(artwork_png_bytes).decode("ascii")
        path_d = anchors_to_svg_path_d(anchors)

        parsed_border = parse_hex_color(border_color)
        clean_hex = rgb_to_hex(parsed_border) if parsed_border else None
        offset_px = round(max(0.0, float(border_offset_mm) * eff_px_per_mm), 2)

        defs_parts: List[str] = []
        border_back_block = ""
        border_front_block = ""
        if clean_hex and path_d:
            if border_cut_position == "inside_base":
                # Base expands outward by offset_px so CutContour cuts INSIDE the colored base
                over_stroke = round(max(1.0, offset_px * 2.0), 2)
                border_back_block = (
                    f'    <path id="DesignBorderFill" d="{path_d}" fill="{clean_hex}" '
                    f'stroke="{clean_hex}" stroke-width="{over_stroke}" '
                    'stroke-linejoin="round" stroke-linecap="round" />\n'
                )
            else:
                # Base is inset inside CutContour by offset_px so CutContour cuts OUTSIDE the base
                if offset_px >= 0.5:
                    gap_stroke = round(offset_px * 2.0, 2)
                    defs_parts.append(
                        '    <mask id="OutsideBaseMask">\n'
                        f'      <path d="{path_d}" fill="#FFFFFF" />\n'
                        f'      <path d="{path_d}" fill="none" stroke="#000000" '
                        f'stroke-width="{gap_stroke}" stroke-linejoin="round" stroke-linecap="round" />\n'
                        "    </mask>"
                    )
                    border_back_block = (
                        f'    <path id="DesignBorderFill" d="{path_d}" fill="{clean_hex}" '
                        'stroke="none" mask="url(#OutsideBaseMask)" />\n'
                    )
                else:
                    border_back_block = (
                        f'    <path id="DesignBorderFill" d="{path_d}" fill="{clean_hex}" stroke="none" />\n'
                    )

            if cut_direction == "inside":
                stroke_px = round(max(2.0, max(0.5, float(border_width_mm)) * eff_px_per_mm) * 2.0, 2)
                defs_parts.append(
                    '    <clipPath id="InsideBorderClip">\n'
                    f'      <path d="{path_d}" />\n'
                    "    </clipPath>"
                )
                border_front_block = (
                    f'    <path id="DesignInsideBorder" d="{path_d}" fill="none" '
                    f'stroke="{clean_hex}" stroke-width="{stroke_px}" '
                    'stroke-linejoin="round" clip-path="url(#InsideBorderClip)" />\n'
                )

        defs_block = ""
        if defs_parts:
            defs_block = "  <defs>\n" + "\n".join(defs_parts) + "\n  </defs>\n"

        svg_cut_stroke_px = round(
            max(0.1, float(cut_stroke_width_pt)) * ((eff_px_per_mm * 25.4) / 72.0), 2
        )

        svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     {size_attr}
     {viewbox_attr}>
  <title>SIETE Sticker Studio - Troquelado 2 Capas</title>
{defs_block}  <!-- Capa 1: Diseño -->
  <g id="Capa_1_Diseno" data-name="Capa 1 - Diseño">
{border_back_block}    <image x="0" y="0" width="{width_px}" height="{height_px}"
           href="data:image/png;base64,{b64}" />
{border_front_block}  </g>
  <!-- Capa 2: Troquel / CutContour -->
  <g id="Capa_2_Corte_CutContour" data-name="Capa 2 - Corte CutContour">
    <path id="CutContour"
          d="{path_d}"
          fill="none"
          stroke="#EC008C"
          stroke-width="{svg_cut_stroke_px}"
          stroke-linecap="round"
          stroke-linejoin="round" />
  </g>
</svg>
'''
        return svg.encode("utf-8")

    @staticmethod
    def _extract_clip_paths_from_alpha(alpha_u8) -> List[List[BezierAnchor]]:
        """
        Extract crisp, high-fidelity closed cubic Bezier clipping contours from an RGBA alpha
        channel at the half-alpha silhouette (`alpha >= 128`) so embedded CMYK artwork in
        Illustrator `.EPS` has true transparency around the design with ZERO white/gray box.
        Returns empty list when the image is completely opaque.
        """
        import cv2
        import numpy as np

        if float(np.mean(alpha_u8 < 25)) <= 0.005:
            return []

        mask = (alpha_u8 >= 128).astype(np.uint8) * 255
        if int(np.count_nonzero(mask)) < 16:
            mask = (alpha_u8 >= 28).astype(np.uint8) * 255
        k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k3, iterations=1)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if not contours:
            return []

        total_area = float(sum(cv2.contourArea(c) for c in contours))
        min_area = max(16.0, total_area * 0.0015)

        valid = sorted(
            (c for c in contours if cv2.contourArea(c) >= min_area),
            key=cv2.contourArea,
            reverse=True,
        )[:24]

        paths: List[List[BezierAnchor]] = []
        for cnt in valid:
            perimeter = cv2.arcLength(cnt, True)
            if perimeter < 8.0:
                continue
            eps = max(0.35, 0.0008 * perimeter)
            approx = cv2.approxPolyDP(cnt, eps, True)
            if len(approx) > 180:
                approx = cv2.approxPolyDP(cnt, eps * (len(approx) / 160.0), True)
            if len(approx) < 3:
                continue
            pts = [(float(pt[0][0]), float(pt[0][1])) for pt in approx]
            bez = _points_to_rounded_bezier_anchors(pts, roundness=0.18)
            if len(bez) >= 3:
                paths.append(bez)
        return paths

    @staticmethod
    def _prepare_eps_raster_rgb(rgb_u8, alpha_u8, *, has_clip_mask: bool):
        """
        Prepare razor-sharp, halo-free float32 RGB `[0..1]` pixels for EPS CMYK raster embedding:
        - Interior opaque artwork (`alpha >= 245`) stays 100% pixel-identical (zero blur/loss).
        - Semi-transparent edge pixels (`alpha < 245`) are purified from the nearest clean opaque
          interior core so ZERO jagged white-speckled halo ever appears around dark outlines.
        - A tight `1.5 px` clean-ink trap extends strictly under the vector clipping boundary
          (`alpha >= 128`), fading cleanly to pure white `(255, 255, 255)` -> `0/0/0/0` CMYK
          (ZERO ink, ZERO radial gray/brown background smear!) beyond `2.5 px`.
        """
        import cv2
        import numpy as np

        if not has_clip_mask:
            rgb_f = rgb_u8.astype(np.float32) / 255.0
            a_f = (alpha_u8.astype(np.float32) / 255.0)[:, :, None]
            return np.clip(rgb_f * a_f + (1.0 - a_f), 0.0, 1.0)

        solid_mask = alpha_u8 >= 220
        if int(np.count_nonzero(solid_mask)) < 24:
            solid_mask = alpha_u8 >= 128
        if int(np.count_nonzero(solid_mask)) < 8:
            rgb_f = rgb_u8.astype(np.float32) / 255.0
            a_f = (alpha_u8.astype(np.float32) / 255.0)[:, :, None]
            return np.clip(rgb_f * a_f + (1.0 - a_f), 0.0, 1.0)

        # Erode solid core by 1px so donor ink colors never come from anti-aliased white fringes
        k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        donor_core = cv2.erode(solid_mask.astype(np.uint8) * 255, k3, iterations=1) > 0
        if int(np.count_nonzero(donor_core)) < 24:
            donor_core = solid_mask

        inv_donor = np.where(donor_core, 0, 1).astype(np.uint8)
        _, nearest_labels = cv2.distanceTransformWithLabels(
            inv_donor, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL
        )
        core_ys, core_xs = np.where(donor_core)
        lbl_idx = np.clip(nearest_labels - 1, 0, len(core_ys) - 1)
        donor_rgb = rgb_u8[core_ys[lbl_idx], core_xs[lbl_idx]].astype(np.float32)

        orig_rgb = rgb_u8.astype(np.float32)
        out_rgb = orig_rgb.copy()

        # Purify semi-transparent edge pixels inside/near the silhouette (zero white speckles!)
        edge_zone = (alpha_u8 >= 1) & (alpha_u8 < 245)
        if np.any(edge_zone):
            a_vals = alpha_u8[edge_zone].astype(np.float32)
            # 100% pure interior ink for alpha < 215, smoothly tapering to 0% at alpha == 245
            donor_w = np.where(
                a_vals < 215.0,
                1.0,
                np.clip((245.0 - a_vals) / 30.0, 0.0, 1.0),
            )[:, None]
            out_rgb[edge_zone] = (
                orig_rgb[edge_zone] * (1.0 - donor_w) + donor_rgb[edge_zone] * donor_w
            )

        # Measure exterior distance from the clip silhouette (`alpha >= 128`)
        clip_bin = (alpha_u8 >= 128).astype(np.uint8)
        if int(np.count_nonzero(clip_bin)) < 16:
            clip_bin = (alpha_u8 >= 28).astype(np.uint8)
        inv_clip = np.where(clip_bin > 0, 0, 1).astype(np.uint8)
        dist_out = cv2.distanceTransform(inv_clip, cv2.DIST_L2, 5)

        # Outside clip: tiny 1.5px pure-ink trap right beneath vector mask, smooth fade [1.5..2.5],
        # and pure white (255, 255, 255) -> 0% CMYK ink everywhere beyond 2.5px!
        outside = clip_bin == 0
        bleed_zone = outside & (dist_out <= 1.5)
        fade_zone = outside & (dist_out > 1.5) & (dist_out <= 2.5)
        far_zone = outside & (dist_out > 2.5)

        if np.any(bleed_zone):
            out_rgb[bleed_zone] = donor_rgb[bleed_zone]
        if np.any(fade_zone):
            t = np.clip((dist_out[fade_zone] - 1.5) / 1.0, 0.0, 1.0)[:, None]
            out_rgb[fade_zone] = donor_rgb[fade_zone] * (1.0 - t) + 255.0 * t
        if np.any(far_zone):
            out_rgb[far_zone] = 255.0

        return np.clip(out_rgb / 255.0, 0.0, 1.0)

    @staticmethod
    def _rgb_float_to_print_cmyk_u8(comp_rgb):
        """
        Convert sRGB float32 `[0..1]` into print-ready CMYK uint8 `(H, W, 4)` with Rich Black UCA:
        - Pure white `(1,1,1)` -> `C=0 M=0 Y=0 K=0` (zero ink).
        - Pure primaries (e.g. vivid yellow `(1,0.8,0)`) stay 100% clean with zero mud.
        - Deep darks & pure black `(0,0,0)` use Rich Black (`C=60% M=50% Y=50% K=100%`, TAC <= 280%)
          so Illustrator & RIPs render crisp deep jet black instead of washed-out charcoal gray.
        """
        import numpy as np

        r = comp_rgb[:, :, 0]
        g = comp_rgb[:, :, 1]
        b = comp_rgb[:, :, 2]

        c0 = 1.0 - r
        m0 = 1.0 - g
        y0 = 1.0 - b

        k_raw = np.minimum(np.minimum(c0, m0), y0)
        denom = np.maximum(1.0 - k_raw, 1e-6)
        non_black = k_raw < 0.9999

        c_pure = np.where(non_black, (c0 - k_raw) / denom, 0.0)
        m_pure = np.where(non_black, (m0 - k_raw) / denom, 0.0)
        y_pure = np.where(non_black, (y0 - k_raw) / denom, 0.0)

        # C1-smooth Rich Black UCA ramp for shadows (k_raw >= 0.35 -> C60 M50 Y50 K100 at black)
        dark_t = np.clip((k_raw - 0.35) / 0.65, 0.0, 1.0)
        dark_w = dark_t * dark_t * (3.0 - 2.0 * dark_t)

        c = np.clip(c_pure * (1.0 - dark_w * 0.40) + 0.60 * dark_w, 0.0, 1.0)
        m = np.clip(m_pure * (1.0 - dark_w * 0.40) + 0.50 * dark_w, 0.0, 1.0)
        y = np.clip(y_pure * (1.0 - dark_w * 0.40) + 0.50 * dark_w, 0.0, 1.0)
        k = np.clip(k_raw, 0.0, 1.0)

        # Cap Total Area Coverage (TAC <= 280%) safely for vinyl sticker printing while preserving K
        tac = c + m + y + k
        over = tac > 2.80
        if np.any(over):
            cmy_sum = np.maximum(c + m + y, 1e-6)
            allowed_cmy = np.maximum(2.80 - k, 0.0)
            scale = np.where(over, allowed_cmy / cmy_sum, 1.0)
            c = c * scale
            m = m * scale
            y = y * scale

        return np.clip(np.rint(np.stack([c, m, y, k], axis=2) * 255.0), 0.0, 255.0).astype(
            np.uint8
        )

    @staticmethod
    def _anchors_to_ai7_path(
        anchors: List[BezierAnchor],
        to_ps_xy,
    ) -> str:
        """Format closed cubic Bezier anchors using Adobe Illustrator 7.0 `m` / `c` operators."""
        first_x, first_y = to_ps_xy(anchors[0].x, anchors[0].y)
        cmds = [f"{first_x:.3f} {first_y:.3f} m"]
        n = len(anchors)
        for i in range(n):
            curr = anchors[i]
            nxt = anchors[(i + 1) % n]
            c1x, c1y = to_ps_xy(curr.out_x, curr.out_y)
            c2x, c2y = to_ps_xy(nxt.in_x, nxt.in_y)
            nx, ny = to_ps_xy(nxt.x, nxt.y)
            cmds.append(
                f"{c1x:.3f} {c1y:.3f} {c2x:.3f} {c2y:.3f} {nx:.3f} {ny:.3f} c"
            )
        return "\n".join(cmds)

    @staticmethod
    def _compose_or_align_layer1_rgba(
        artwork_png_bytes: bytes,
        *,
        width_px: int,
        height_px: int,
        dpi: int = 300,
        white_border_mm: float = 0.0,
        remove_background: bool = False,
        bg_tolerance: int = 28,
        mode: DieCutShapeMode = "en_su_forma",
        raw_px_per_mm: Optional[float] = None,
    ):
        """
        Ensure Layer 1 RGBA array matches the exact `(width_px, height_px)` coordinate space of `anchors`.

        When `artwork_png_bytes` comes directly from `item.enhanced_storage_path` (unpadded `orig_w x orig_h`)
        while `(width_px, height_px)` is the padded die-cut canvas (`orig_w + 2*pad, orig_h + 2*pad`),
        composes the padded canvas (including background removal and Euclidean distance-transform
        `white_border_mm`) instead of stretching the unpadded image.
        """
        import cv2
        import numpy as np
        from PIL import Image, ImageOps

        pil_img = ImageOps.exif_transpose(Image.open(io.BytesIO(artwork_png_bytes))).convert("RGBA")
        src_w, src_h = pil_img.size

        if (src_w, src_h) == (width_px, height_px):
            return np.array(pil_img, dtype=np.uint8)

        diff_w = width_px - src_w
        diff_h = height_px - src_h
        # Symmetric die-cut canvas padding around an unpadded enhanced source image
        if diff_w >= 8 and diff_h >= 8 and abs(diff_w - diff_h) <= 6:
            rgba_src = np.array(pil_img, dtype=np.uint8)
            rgb = rgba_src[:, :, :3]
            alpha = rgba_src[:, :, 3]

            if remove_background or mode == "en_su_forma":
                rgb, alpha, _ = _segment_opaque_perimeter_subject(
                    rgb,
                    alpha,
                    bg_tolerance=bg_tolerance,
                    force_remove=bool(remove_background),
                )

            pad_x = diff_w // 2
            pad_y = diff_h // 2
            padded_rgb = np.zeros((height_px, width_px, 3), dtype=np.uint8)
            padded_alpha = np.zeros((height_px, width_px), dtype=np.uint8)
            padded_rgb[pad_y : pad_y + src_h, pad_x : pad_x + src_w] = rgb
            padded_alpha[pad_y : pad_y + src_h, pad_x : pad_x + src_w] = alpha

            wb_mm = max(0.0, min(10.0, float(white_border_mm)))
            if wb_mm > 0.0:
                px_per_mm = raw_px_per_mm if (raw_px_per_mm and raw_px_per_mm > 0) else (dpi / 25.4)
                wb_px = max(1, min(max(12, min(src_w, src_h) // 2), int(round(wb_mm * px_per_mm))))
                fg_mask = _build_clean_alpha_mask(
                    padded_alpha,
                    alpha_threshold=45,
                    min_area_ratio=0.0005,
                    reference_area=float(src_w * src_h),
                )
                inv_fg = np.where(fg_mask > 127, 0, 255).astype(np.uint8)
                dist_wb = cv2.distanceTransform(inv_fg, cv2.DIST_L2, 5)
                dilated_white = np.where(dist_wb <= float(wb_px), 255, 0).astype(np.uint8)
                smooth_white = cv2.GaussianBlur(dilated_white, (3, 3), 0)

                art_a = (padded_alpha.astype(np.float32) / 255.0)[:, :, None]
                wb_a = (smooth_white.astype(np.float32) / 255.0)[:, :, None]
                out_a = art_a + wb_a * (1.0 - art_a)
                safe_out_a = np.maximum(out_a, 1e-6)
                out_rgb = (
                    padded_rgb.astype(np.float32) * art_a + 255.0 * wb_a * (1.0 - art_a)
                ) / safe_out_a
                out_rgb = np.where(out_a > 1e-4, out_rgb, 0.0)
                padded_rgb = np.rint(out_rgb).clip(0, 255).astype(np.uint8)
                padded_alpha = np.rint(out_a[:, :, 0] * 255.0).clip(0, 255).astype(np.uint8)

            return np.dstack([padded_rgb, padded_alpha])

        resized = pil_img.resize((width_px, height_px), Image.Resampling.LANCZOS)
        return np.array(resized, dtype=np.uint8)

    @staticmethod
    def _crop_rgba_and_shift_anchors(
        rgba_u8,
        anchors: List[BezierAnchor],
        *,
        doc_w_cm: float,
        doc_h_cm: float,
        fit_mode: DieCutFitMode = "contain_proportional",
    ) -> Tuple["object", List[BezierAnchor], int, int]:
        """
        Crop Layer 1 `rgba_u8` and shift Layer 2 `anchors` to the exact active frame of the
        `CutContour` bounding box so both layers share the `(0, 0)` origin and full enhanced resolution.
        """
        import numpy as np

        h_px, w_px = rgba_u8.shape[:2]
        cut_x0, cut_y0, cut_w_px, cut_h_px = _compute_cut_contour_bbox_px(anchors, w_px, h_px)
        cut_cx = cut_x0 + cut_w_px * 0.5
        cut_cy = cut_y0 + cut_h_px * 0.5

        if fit_mode == "exact_stretch":
            frame_w_px = max(16, int(round(cut_w_px)))
            frame_h_px = max(16, int(round(cut_h_px)))
        else:
            cm_per_px = min(doc_w_cm / cut_w_px, doc_h_cm / cut_h_px)
            frame_w_px = max(16, int(round(doc_w_cm / cm_per_px)))
            frame_h_px = max(16, int(round(doc_h_cm / cm_per_px)))

        ix0 = int(round(cut_cx - frame_w_px * 0.5))
        iy0 = int(round(cut_cy - frame_h_px * 0.5))
        ix1 = ix0 + frame_w_px
        iy1 = iy0 + frame_h_px

        # Allocate clean transparent white-RGB frame `(frame_h_px, frame_w_px, 4)`
        cropped = np.zeros((frame_h_px, frame_w_px, 4), dtype=np.uint8)
        cropped[:, :, :3] = 255

        src_x0 = max(0, ix0)
        src_y0 = max(0, iy0)
        src_x1 = min(w_px, ix1)
        src_y1 = min(h_px, iy1)

        if src_x1 > src_x0 and src_y1 > src_y0:
            dst_x0 = src_x0 - ix0
            dst_y0 = src_y0 - iy0
            cropped[dst_y0 : dst_y0 + (src_y1 - src_y0), dst_x0 : dst_x0 + (src_x1 - src_x0)] = (
                rgba_u8[src_y0:src_y1, src_x0:src_x1]
            )

        dx = float(ix0)
        dy = float(iy0)
        shifted_anchors = [
            BezierAnchor(
                x=round(a.x - dx, 3),
                y=round(a.y - dy, 3),
                in_x=round(a.in_x - dx, 3),
                in_y=round(a.in_y - dy, 3),
                out_x=round(a.out_x - dx, 3),
                out_y=round(a.out_y - dy, 3),
                smooth=a.smooth,
            )
            for a in anchors
        ]
        return cropped, shifted_anchors, frame_w_px, frame_h_px

    def export_two_layer_eps(
        self,
        artwork_png_bytes: bytes,
        anchors: List[BezierAnchor],
        *,
        width_px: int,
        height_px: int,
        dpi: int = 300,
        title: str = "SIETE_Sticker_DieCut",
        border_color: Optional[str] = None,
        cut_direction: DieCutDirection = "outside",
        border_width_mm: float = 2.0,
        border_cut_position: DieCutBorderCutPosition = "inside_base",
        border_offset_mm: float = 1.5,
        cut_stroke_width_pt: float = 0.5,
        target_width_cm: Optional[float] = None,
        target_height_cm: Optional[float] = None,
        fit_mode: DieCutFitMode = "contain_proportional",
        item: Optional[Any] = None,
        white_border_mm: float = 0.0,
        remove_background: bool = False,
        bg_tolerance: int = 28,
        mode: DieCutShapeMode = "en_su_forma",
    ) -> bytes:
        """
        Generate native Adobe Illustrator 7.0–compatible 2-Layer EPS (`%!PS-Adobe-3.0 EPSF-3.0`):
        - Opens in Adobe Illustrator / CorelDRAW with TWO genuine top-level layers:
          1. `Capa 1 - Diseno`: Embedded 4-channel Rich-Black CMYK raster (`%AI5_BeginRaster` / `XI`),
             edge-purified with zero background smear and wrapped in an official AI7 clipping mask
             group (`u / q / <paint style> / <path> / h / W / n / ... / Q / U`).
          2. `Capa 2 - CutContour`: Editable closed cubic Bezier vector path stroked with
             Spot Color `(CutContour)` (`0 1 0 0 (CutContour) 0 X`), ready for plotters & RIPs.
        - When `target_width_cm` / `target_height_cm` are provided, frames both Layer 1 and Layer 2
          to the `CutContour` bounding box (`PT_PER_CM = 72.0 / 2.54 = 28.3464567`) with shared
          `(0, 0)` origin so `%%HiResBoundingBox`, raster, and `CutContour` align 1:1.
        """
        import numpy as np
        from PIL import Image

        if len(anchors) < 3:
            raise ValueError("El trazado de troquelado requiere al menos 3 puntos de ancla.")

        aligned_rgba = self._compose_or_align_layer1_rgba(
            artwork_png_bytes,
            width_px=width_px,
            height_px=height_px,
            dpi=dpi,
            white_border_mm=white_border_mm,
            remove_background=remove_background,
            bg_tolerance=bg_tolerance,
            mode=mode,
        )

        if border_color:
            tmp_buf = io.BytesIO()
            Image.fromarray(aligned_rgba, mode="RGBA").save(tmp_buf, format="PNG")
            composited_bytes = composite_border_onto_artwork(
                tmp_buf.getvalue(),
                anchors,
                width_px=width_px,
                height_px=height_px,
                border_color=border_color,
                cut_direction=cut_direction,
                border_width_mm=border_width_mm,
                border_cut_position=border_cut_position,
                border_offset_mm=border_offset_mm,
                dpi=dpi,
            )
            aligned_rgba = np.array(
                Image.open(io.BytesIO(composited_bytes)).convert("RGBA"), dtype=np.uint8
            )

        cut_x0, cut_y0, cut_w_px, cut_h_px = _compute_cut_contour_bbox_px(
            anchors, width_px, height_px
        )
        oriented_target = _resolve_auto_oriented_target_cm(
            cut_w_px, cut_h_px, target_width_cm, target_height_cm, item=item
        )

        if oriented_target is not None:
            doc_w_cm, doc_h_cm = oriented_target
            rgba_u8, active_anchors, out_w_px, out_h_px = self._crop_rgba_and_shift_anchors(
                aligned_rgba,
                anchors,
                doc_w_cm=doc_w_cm,
                doc_h_cm=doc_h_cm,
                fit_mode=fit_mode,
            )
            width_pt = doc_w_cm * PT_PER_CM
            height_pt = doc_h_cm * PT_PER_CM
            bb_w = max(1, int(round(width_pt)))
            bb_h = max(1, int(round(height_pt)))

            if fit_mode == "exact_stretch":
                scale_x = width_pt / float(out_w_px)
                scale_y = height_pt / float(out_h_px)
            else:
                scale_pt = min(width_pt / float(out_w_px), height_pt / float(out_h_px))
                scale_x = scale_pt
                scale_y = scale_pt

            tx = (width_pt - float(out_w_px) * scale_x) * 0.5
            ty = height_pt - (height_pt - float(out_h_px) * scale_y) * 0.5
            tx_str = "0" if abs(tx) < 1e-3 else f"{tx:.3f}"
            ty_str = f"{ty:.3f}"
        else:
            rgba_u8 = aligned_rgba
            active_anchors = anchors
            out_w_px = width_px
            out_h_px = height_px
            width_pt = (out_w_px / float(dpi)) * 72.0
            height_pt = (out_h_px / float(dpi)) * 72.0
            bb_w = max(1, int(math.ceil(width_pt)))
            bb_h = max(1, int(math.ceil(height_pt)))
            scale_x = width_pt / float(out_w_px)
            scale_y = height_pt / float(out_h_px)
            tx = 0.0
            ty = height_pt
            tx_str = "0"
            ty_str = f"{height_pt:.3f}"

        rgb_u8 = rgba_u8[:, :, :3]
        alpha_u8 = rgba_u8[:, :, 3]

        # Extract smooth silhouette clipping mask(s) BEFORE flattening to CMYK -> true transparency!
        clip_paths = self._extract_clip_paths_from_alpha(alpha_u8)

        # Purify anti-aliased edge pixels & composite exterior over pure white (0/0/0/0 CMYK)
        comp_rgb = self._prepare_eps_raster_rgb(
            rgb_u8, alpha_u8, has_clip_mask=bool(clip_paths)
        )
        cmyk_u8 = self._rgb_float_to_print_cmyk_u8(comp_rgb)

        # AI7 XI embedded raster stream: `%`-prefixed uppercase CMYK hex lines (exact W*H*4 bytes)
        raw_hex = cmyk_u8.tobytes().hex().upper()
        hex_lines = "\n".join(f"%{raw_hex[i : i + 76]}" for i in range(0, len(raw_hex), 76))

        def to_ps_xy(px_x: float, px_y: float) -> Tuple[float, float]:
            sx = float(px_x) if math.isfinite(px_x) else 0.0
            sy = float(px_y) if math.isfinite(px_y) else 0.0
            ps_x = max(0.0, min(width_pt, tx + sx * scale_x))
            ps_y = max(0.0, min(height_pt, ty - sy * scale_y))
            return ps_x, ps_y

        cut_path_str = self._anchors_to_ai7_path(active_anchors, to_ps_xy)
        safe_title = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in title)[:80] or "SIETE_DieCut"

        safe_stroke_pt = max(0.1, min(5.0, float(cut_stroke_width_pt)))

        raster_block = [
            "%AI5_BeginRaster",
            f"[ {scale_x:.6f} 0 0 {scale_y:.6f} {tx_str} {ty_str} ] 0 0 {out_w_px} {out_h_px} {out_w_px} {out_h_px} 8 4 0 0 0 0 XI",
            hex_lines,
            "%AI5_EndRaster",
            "N",
        ]

        mask_paint_style = [
            "0 O",
            "0 g",
            "0 R",
            "0 G",
            "1 i 0 J 0 j 1 w 4 M []0 d",
            "0 D",
        ]

        layer1_body: List[str] = []
        if len(clip_paths) == 1:
            layer1_body.extend(["u", "0 A", "q"])
            layer1_body.extend(mask_paint_style)
            layer1_body.append(self._anchors_to_ai7_path(clip_paths[0], to_ps_xy))
            layer1_body.extend(["h", "W", "n"])
            layer1_body.extend(raster_block)
            layer1_body.extend(["Q", "U"])
        elif len(clip_paths) > 1:
            layer1_body.extend(["u", "0 A", "q", "*u"])
            layer1_body.extend(mask_paint_style)
            for cp in clip_paths:
                layer1_body.append(self._anchors_to_ai7_path(cp, to_ps_xy))
                layer1_body.extend(["h", "W", "n"])
            layer1_body.append("*U")
            layer1_body.extend(raster_block)
            layer1_body.extend(["Q", "U"])
        else:
            layer1_body.extend(raster_block)

        eps_lines = [
            "%!PS-Adobe-3.0 EPSF-3.0",
            "%%Creator: Adobe Illustrator(R) 7.0",
            "%%For: (SIETE Sticker Studio) ()",
            f"%%Title: ({safe_title}.eps)",
            "%%CreationDate: (2026) (00:00)",
            f"%%BoundingBox: 0 0 {bb_w} {bb_h}",
            f"%%HiResBoundingBox: 0.000 0.000 {width_pt:.3f} {height_pt:.3f}",
            "%%DocumentProcessColors: Cyan Magenta Yellow Black",
            "%%DocumentCustomColors: (CutContour)",
            "%%CMYKCustomColor: 0 1 0 0 (CutContour)",
            "%AI5_FileFormat 3.0",
            "%AI3_ColorUsage: Color",
            f"%AI5_ArtSize: {width_pt:.3f} {height_pt:.3f}",
            "%AI5_RulerUnits: 1",
            "%AI5_ArtFlags: 1 0 0 1 0 0 1 1 0",
            "%AI5_TargetResolution: 800",
            "%AI5_NumLayers: 2",
            "%%EndComments",
            "%%BeginProlog",
            "%%EndProlog",
            "%%BeginSetup",
            "%%EndSetup",
            "%AI5_BeginLayer",
            "1 1 1 1 0 0 0 79 128 255 Lb",
            "(Capa 1 - Diseno) Ln",
            "0 A",
            *layer1_body,
            "LB",
            "%AI5_EndLayer",
            "%AI5_BeginLayer",
            "1 1 1 1 0 0 1 255 79 79 Lb",
            "(Capa 2 - CutContour) Ln",
            "0 A",
            "0 R",
            "0 1 0 0 (CutContour) 0 X",
            f"1 J 1 j {safe_stroke_pt:.2f} w 10 M []0 d",
            cut_path_str,
            "s",
            "LB",
            "%AI5_EndLayer",
            "%%PageTrailer",
            "%%Trailer",
            "%%EOF",
            "",
        ]

        return "\n".join(eps_lines).encode("ascii")

    # =========================================================================
    # Multi-Design Order Production Export (Single-Sheet .EPS & Multi-Page .PDF)
    # =========================================================================

    def prepare_item_for_production(
        self,
        artwork_png_bytes: bytes,
        *,
        item: Any,
        saved_anchors: Optional[List[BezierAnchor]] = None,
        saved_config: Optional[dict] = None,
        dpi: int = 300,
    ) -> dict[str, Any]:
        """
        Prepare a single `OrderItem` design for multi-design production export (`.EPS` or `.PDF`):
        - Uses the saved `anchors` and die-cut parameters (`white_border_mm`, `target_width_cm`,
          `target_height_cm`, `fit_mode`, `border_color`, `remove_background`, etc.) if available,
          or detects the die-cut silhouette automatically from `artwork_png_bytes` (enhanced image).
        - Crops/frames both Layer 1 RGBA (composited cleanly over white for 0 black artifacts)
          and Layer 2 `anchors` to the exact physical size `(width_cm, height_cm)` of the item.
        """
        import numpy as np
        from PIL import Image

        cfg = dict(saved_config or {})
        eff_dpi = int(cfg.get("dpi") or dpi or 300)
        mode: DieCutShapeMode = cfg.get("mode") or "en_su_forma"
        if not cfg.get("mode") and item is not None:
            shape_obj = getattr(item, "shape", None)
            shape_name = getattr(shape_obj, "name", None) if shape_obj else None
            if shape_name == "Circular" or getattr(item, "diameter_cm", None) is not None:
                mode = "circular"

        cut_direction: DieCutDirection = cfg.get("cut_direction") or "outside"
        bleed_mm = float(cfg.get("bleed_mm", 2.5))
        white_border_mm = float(cfg.get("white_border_mm", 0.0))
        remove_bg = bool(cfg.get("remove_background", False))
        bg_tol = int(cfg.get("bg_tolerance", 28))
        border_color = cfg.get("border_color")
        border_width_mm = float(cfg.get("border_width_mm", 2.0))
        border_cut_position: DieCutBorderCutPosition = cfg.get("border_cut_position") or "inside_base"
        border_offset_mm = float(cfg.get("border_offset_mm", 1.5))
        fit_mode: DieCutFitMode = cfg.get("fit_mode") or "contain_proportional"
        target_w_cm = cfg.get("target_width_cm")
        target_h_cm = cfg.get("target_height_cm")

        if saved_anchors and len(saved_anchors) >= 3:
            canvas_w = int(cfg.get("image_width") or 0)
            canvas_h = int(cfg.get("image_height") or 0)
            if canvas_w <= 0 or canvas_h <= 0:
                with Image.open(io.BytesIO(artwork_png_bytes)) as pil_im:
                    src_w, src_h = pil_im.size
                max_ax = max(max(a.x, a.in_x, a.out_x) for a in saved_anchors)
                max_ay = max(max(a.y, a.in_y, a.out_y) for a in saved_anchors)
                canvas_w = max(src_w, int(math.ceil(max_ax + 18)))
                canvas_h = max(src_h, int(math.ceil(max_ay + 18)))

            aligned_rgba = self._compose_or_align_layer1_rgba(
                artwork_png_bytes,
                width_px=canvas_w,
                height_px=canvas_h,
                dpi=eff_dpi,
                white_border_mm=white_border_mm,
                remove_background=remove_bg,
                bg_tolerance=bg_tol,
                mode=mode,
            )
            anchors = list(saved_anchors)
        else:
            det = self._detect_die_cut(
                EdgeDetectionPayload(
                    asset=ImageAsset(
                        order_id=str(getattr(item, "order_id", "1")),
                        content=artwork_png_bytes,
                        content_type="image/png",
                        filename=getattr(item, "image_safe_filename", "item.png") or "item.png",
                    ),
                    mode=mode,
                    cut_direction=cut_direction,
                    dpi=eff_dpi,
                    bleed_mm=bleed_mm,
                    white_border_mm=white_border_mm,
                    remove_background=remove_bg,
                    bg_tolerance=bg_tol,
                    border_color=border_color,
                    border_width_mm=border_width_mm,
                    border_cut_position=border_cut_position,
                    border_offset_mm=border_offset_mm,
                    target_width_cm=target_w_cm,
                    target_height_cm=target_h_cm,
                    fit_mode=fit_mode,
                    item=item,
                )
            )
            canvas_w = det.image_width
            canvas_h = det.image_height
            anchors = det.anchors
            aligned_rgba = np.array(
                Image.open(io.BytesIO(det.artwork_png_bytes)).convert("RGBA"),
                dtype=np.uint8,
            )

        if border_color:
            tmp_buf = io.BytesIO()
            Image.fromarray(aligned_rgba, mode="RGBA").save(tmp_buf, format="PNG")
            comp_bytes = composite_border_onto_artwork(
                tmp_buf.getvalue(),
                anchors,
                width_px=canvas_w,
                height_px=canvas_h,
                border_color=border_color,
                cut_direction=cut_direction,
                border_width_mm=border_width_mm,
                border_cut_position=border_cut_position,
                border_offset_mm=border_offset_mm,
                dpi=eff_dpi,
            )
            aligned_rgba = np.array(
                Image.open(io.BytesIO(comp_bytes)).convert("RGBA"), dtype=np.uint8
            )

        _, _, cut_w_px, cut_h_px = _compute_cut_contour_bbox_px(anchors, canvas_w, canvas_h)
        oriented = _resolve_auto_oriented_target_cm(
            cut_w_px, cut_h_px, target_w_cm, target_h_cm, item=item
        )
        if oriented is not None:
            doc_w_cm, doc_h_cm = oriented
        else:
            doc_w_cm = round((cut_w_px / eff_dpi) * 2.54, 2)
            doc_h_cm = round((cut_h_px / eff_dpi) * 2.54, 2)

        doc_w_cm = max(0.5, float(doc_w_cm))
        doc_h_cm = max(0.5, float(doc_h_cm))

        cropped_rgba, shifted_anchors, crop_w, crop_h = self._crop_rgba_and_shift_anchors(
            aligned_rgba,
            anchors,
            doc_w_cm=doc_w_cm,
            doc_h_cm=doc_h_cm,
            fit_mode=fit_mode,
        )
        rgb_u8 = cropped_rgba[:, :, :3]
        alpha_u8 = cropped_rgba[:, :, 3]
        clip_paths = self._extract_clip_paths_from_alpha(alpha_u8)
        comp_rgb_f = self._prepare_eps_raster_rgb(
            rgb_u8, alpha_u8, has_clip_mask=bool(clip_paths)
        )
        cmyk_u8 = self._rgb_float_to_print_cmyk_u8(comp_rgb_f)
        comp_rgb_u8 = np.clip(np.rint(comp_rgb_f * 255.0), 0.0, 255.0).astype(np.uint8)

        pos = int(getattr(item, "position", 1) or 1)
        qty = int(getattr(item, "quantity", 1) or 1)
        size_disp = getattr(item, "size_display", f"{doc_w_cm:g}x{doc_h_cm:g}cm") or f"{doc_w_cm:g}x{doc_h_cm:g}cm"
        mat_obj = getattr(item, "material", None)
        mat_name = getattr(mat_obj, "name", "General") if mat_obj else "General"

        return {
            "item_id": str(getattr(item, "id", pos)),
            "position": pos,
            "quantity": qty,
            "material": mat_name,
            "size_display": size_disp,
            "label": f"Diseno #{pos:02d} ({size_disp}) x{qty}",
            "width_cm": round(doc_w_cm, 4),
            "height_cm": round(doc_h_cm, 4),
            "crop_w_px": crop_w,
            "crop_h_px": crop_h,
            "cmyk_u8": cmyk_u8,
            "comp_rgb_u8": comp_rgb_u8,
            "alpha_u8": alpha_u8,
            "anchors": shifted_anchors,
            "clip_paths": clip_paths,
            "fit_mode": fit_mode,
        }

    def export_multi_design_eps(
        self,
        prepared_designs: List[dict[str, Any]],
        *,
        title: str = "SIETE_Production_Order",
        layout_mode: Literal["same_sheet", "separate_artboards"] = "same_sheet",
        margin_cm: float = 1.0,
        gap_cm: float = 0.5,
        artboard_gap_cm: float = 3.0,
        sheet_width_cm: Optional[float] = None,
        cut_stroke_width_pt: float = 0.5,
    ) -> Tuple[bytes, List[dict[str, Any]]]:
        """
        Export 2+ order designs into a single 2-Layer Adobe Illustrator 7.0 `.EPS`:
        - `layout_mode == "same_sheet"` (Caso 1 — non-roll jobs):
          Places all designs on the SAME sheet without overlap (`gap_cm = 0.5 cm`,
          `margin_cm = 1.0 cm`), each at its exact physical cm size.
        - `layout_mode == "separate_artboards"` (Caso 2 — `En rollo` jobs when `.EPS` is requested):
          Places each design in its own clearly delimited artboard frame/lane separated by a fixed
          distance (`artboard_gap_cm = 3.0 cm`), with a guide border and reference label outside
          the `CutContour`.
        """
        if not prepared_designs:
            raise ValueError("Se requiere al menos un diseño para exportar producción.")

        safe_margin_cm = max(0.2, float(margin_cm))
        safe_gap_cm = max(0.1, float(gap_cm))
        safe_ab_gap_cm = max(0.5, float(artboard_gap_cm))
        safe_stroke_pt = max(0.1, min(5.0, float(cut_stroke_width_pt)))

        placements: List[dict[str, Any]] = []

        if layout_mode == "separate_artboards":
            # Horizontal lane of separate artboard frames with 3.0 cm fixed distance between frames
            # and a 0.8 cm label header band above each artboard frame (strictly outside CutContour)
            label_band_cm = 0.8
            cursor_frame_x_cm = 0.0
            max_frame_h_cm = 0.0

            for idx, d in enumerate(prepared_designs, start=1):
                dw = float(d["width_cm"])
                dh = float(d["height_cm"])
                frame_w_cm = dw + 2.0 * safe_margin_cm
                frame_h_cm = dh + 2.0 * safe_margin_cm + label_band_cm

                design_x_cm = cursor_frame_x_cm + safe_margin_cm
                design_y_cm = label_band_cm + safe_margin_cm

                placements.append(
                    {
                        "design": d,
                        "artboard_index": idx,
                        "x_cm": round(design_x_cm, 4),
                        "y_cm": round(design_y_cm, 4),
                        "width_cm": round(dw, 4),
                        "height_cm": round(dh, 4),
                        "frame_x_cm": round(cursor_frame_x_cm, 4),
                        "frame_y_cm": 0.0,
                        "frame_w_cm": round(frame_w_cm, 4),
                        "frame_h_cm": round(frame_h_cm, 4),
                    }
                )
                cursor_frame_x_cm += frame_w_cm + safe_ab_gap_cm
                max_frame_h_cm = max(max_frame_h_cm, frame_h_cm)

            total_w_cm = max(
                p["frame_x_cm"] + p["frame_w_cm"] for p in placements
            )
            total_h_cm = max_frame_h_cm
        else:
            # Caso 1: "same_sheet" — shelf packing on a single sheet with margin_cm=1.0 and gap_cm=0.5
            max_item_w = max(float(d["width_cm"]) for d in prepared_designs)
            sum_item_w = sum(float(d["width_cm"]) for d in prepared_designs) + safe_gap_cm * max(
                0, len(prepared_designs) - 1
            )
            if sheet_width_cm is not None and sheet_width_cm >= max_item_w + 2.0 * safe_margin_cm:
                target_usable_w_cm = float(sheet_width_cm) - 2.0 * safe_margin_cm
            else:
                target_usable_w_cm = max(max_item_w, min(42.0, sum_item_w))

            cur_x_cm = safe_margin_cm
            cur_y_cm = safe_margin_cm
            row_h_cm = 0.0

            for idx, d in enumerate(prepared_designs, start=1):
                dw = float(d["width_cm"])
                dh = float(d["height_cm"])
                if (
                    cur_x_cm > safe_margin_cm
                    and (cur_x_cm - safe_margin_cm + dw) > (target_usable_w_cm + 1e-4)
                ):
                    cur_x_cm = safe_margin_cm
                    cur_y_cm += row_h_cm + safe_gap_cm
                    row_h_cm = 0.0

                placements.append(
                    {
                        "design": d,
                        "artboard_index": 1,
                        "x_cm": round(cur_x_cm, 4),
                        "y_cm": round(cur_y_cm, 4),
                        "width_cm": round(dw, 4),
                        "height_cm": round(dh, 4),
                    }
                )
                cur_x_cm += dw + safe_gap_cm
                row_h_cm = max(row_h_cm, dh)

            total_w_cm = max(p["x_cm"] + p["width_cm"] for p in placements) + safe_margin_cm
            total_h_cm = max(p["y_cm"] + p["height_cm"] for p in placements) + safe_margin_cm

        sheet_w_pt = total_w_cm * PT_PER_CM
        sheet_h_pt = total_h_cm * PT_PER_CM
        bb_w = max(1, int(round(sheet_w_pt)))
        bb_h = max(1, int(round(sheet_h_pt)))

        mask_paint_style = [
            "0 O",
            "0 g",
            "0 R",
            "0 G",
            "1 i 0 J 0 j 1 w 4 M []0 d",
            "0 D",
        ]

        layer1_body: List[str] = []
        layer2_body: List[str] = [
            "0 A",
            "0 R",
            "0 1 0 0 (CutContour) 0 X",
            f"1 J 1 j {safe_stroke_pt:.2f} w 10 M []0 d",
        ]

        for p in placements:
            d = p["design"]
            crop_w = int(d["crop_w_px"])
            crop_h = int(d["crop_h_px"])
            w_pt = float(p["width_cm"]) * PT_PER_CM
            h_pt = float(p["height_cm"]) * PT_PER_CM

            left_x_pt = float(p["x_cm"]) * PT_PER_CM
            top_y_pt = sheet_h_pt - float(p["y_cm"]) * PT_PER_CM

            if d.get("fit_mode") == "exact_stretch":
                scale_x = w_pt / float(crop_w)
                scale_y = h_pt / float(crop_h)
            else:
                scale_pt = min(w_pt / float(crop_w), h_pt / float(crop_h))
                scale_x = scale_pt
                scale_y = scale_pt

            tx = left_x_pt + (w_pt - float(crop_w) * scale_x) * 0.5
            ty = top_y_pt - (h_pt - float(crop_h) * scale_y) * 0.5

            def _make_mapper(tx_val: float, ty_val: float, sx_val: float, sy_val: float):
                def _to_ps(px_x: float, px_y: float) -> Tuple[float, float]:
                    x_f = float(px_x) if math.isfinite(px_x) else 0.0
                    y_f = float(px_y) if math.isfinite(px_y) else 0.0
                    ps_x = max(0.0, min(sheet_w_pt, tx_val + x_f * sx_val))
                    ps_y = max(0.0, min(sheet_h_pt, ty_val - y_f * sy_val))
                    return ps_x, ps_y

                return _to_ps

            to_ps_xy = _make_mapper(tx, ty, scale_x, scale_y)

            if layout_mode == "separate_artboards":
                fx0_pt = float(p["frame_x_cm"]) * PT_PER_CM
                fw_pt = float(p["frame_w_cm"]) * PT_PER_CM
                fh_pt = float(p["frame_h_cm"]) * PT_PER_CM
                ftop_pt = sheet_h_pt - float(p["frame_y_cm"]) * PT_PER_CM
                fbot_pt = max(0.0, ftop_pt - fh_pt)
                fright_pt = min(sheet_w_pt, fx0_pt + fw_pt)
                lbl_y_pt = max(2.0, min(sheet_h_pt - 4.0, ftop_pt - 14.0))
                safe_lbl = "".join(
                    ch if ch.isalnum() or ch in " -_#()x." else "_" for ch in str(d["label"])
                )
                layer1_body.extend(
                    [
                        f"% --- Artboard Frame #{p['artboard_index']:02d}: {safe_lbl} ---",
                        "0 A",
                        "0.55 0.35 0 0.15 K",
                        "0.75 w [4 3] 0 d",
                        f"{fx0_pt:.3f} {fbot_pt:.3f} m",
                        f"{fright_pt:.3f} {fbot_pt:.3f} L",
                        f"{fright_pt:.3f} {ftop_pt:.3f} L",
                        f"{fx0_pt:.3f} {ftop_pt:.3f} L",
                        f"{fx0_pt:.3f} {fbot_pt:.3f} L",
                        "s",
                        "[] 0 d",
                        f"%AI5_Note: ({safe_lbl} @ x={fx0_pt:.1f}pt y={lbl_y_pt:.1f}pt)",
                    ]
                )

            raw_hex = d["cmyk_u8"].tobytes().hex().upper()
            hex_lines = "\n".join(f"%{raw_hex[i : i + 76]}" for i in range(0, len(raw_hex), 76))
            raster_block = [
                "%AI5_BeginRaster",
                f"[ {scale_x:.6f} 0 0 {scale_y:.6f} {tx:.3f} {ty:.3f} ] 0 0 {crop_w} {crop_h} {crop_w} {crop_h} 8 4 0 0 0 0 XI",
                hex_lines,
                "%AI5_EndRaster",
                "N",
            ]

            clip_paths = d["clip_paths"]
            if len(clip_paths) == 1:
                layer1_body.extend(["u", "0 A", "q"])
                layer1_body.extend(mask_paint_style)
                layer1_body.append(self._anchors_to_ai7_path(clip_paths[0], to_ps_xy))
                layer1_body.extend(["h", "W", "n"])
                layer1_body.extend(raster_block)
                layer1_body.extend(["Q", "U"])
            elif len(clip_paths) > 1:
                layer1_body.extend(["u", "0 A", "q", "*u"])
                layer1_body.extend(mask_paint_style)
                for cp in clip_paths:
                    layer1_body.append(self._anchors_to_ai7_path(cp, to_ps_xy))
                    layer1_body.extend(["h", "W", "n"])
                layer1_body.append("*U")
                layer1_body.extend(raster_block)
                layer1_body.extend(["Q", "U"])
            else:
                layer1_body.extend(raster_block)

            layer2_body.append(self._anchors_to_ai7_path(d["anchors"], to_ps_xy))
            layer2_body.append("s")

        safe_title = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in title)[:80] or "SIETE_Production"
        eps_lines = [
            "%!PS-Adobe-3.0 EPSF-3.0",
            "%%Creator: Adobe Illustrator(R) 7.0",
            "%%For: (SIETE Sticker Studio) ()",
            f"%%Title: ({safe_title}.eps)",
            "%%CreationDate: (2026) (00:00)",
            f"%%BoundingBox: 0 0 {bb_w} {bb_h}",
            f"%%HiResBoundingBox: 0.000 0.000 {sheet_w_pt:.3f} {sheet_h_pt:.3f}",
            "%%DocumentProcessColors: Cyan Magenta Yellow Black",
            "%%DocumentCustomColors: (CutContour)",
            "%%CMYKCustomColor: 0 1 0 0 (CutContour)",
            f"%SIETE_LayoutMode: {layout_mode}",
            f"%SIETE_DesignsCount: {len(placements)}",
            "%AI5_FileFormat 3.0",
            "%AI3_ColorUsage: Color",
            f"%AI5_ArtSize: {sheet_w_pt:.3f} {sheet_h_pt:.3f}",
            "%AI5_RulerUnits: 1",
            "%AI5_ArtFlags: 1 0 0 1 0 0 1 1 0",
            "%AI5_TargetResolution: 800",
            "%AI5_NumLayers: 2",
            "%%EndComments",
            "%%BeginProlog",
            "%%EndProlog",
            "%%BeginSetup",
            "%%EndSetup",
            "%AI5_BeginLayer",
            "1 1 1 1 0 0 0 79 128 255 Lb",
            "(Capa 1 - Diseno) Ln",
            "0 A",
            *layer1_body,
            "LB",
            "%AI5_EndLayer",
            "%AI5_BeginLayer",
            "1 1 1 1 0 0 1 255 79 79 Lb",
            "(Capa 2 - CutContour) Ln",
            *layer2_body,
            "LB",
            "%AI5_EndLayer",
            "%%PageTrailer",
            "%%Trailer",
            "%%EOF",
            "",
        ]
        return "\n".join(eps_lines).encode("ascii"), placements

    def export_multi_artboard_pdf(
        self,
        prepared_designs: List[dict[str, Any]],
        *,
        title: str = "SIETE_Roll_Production",
        margin_cm: float = 0.5,
        cut_stroke_width_pt: float = 0.5,
    ) -> Tuple[bytes, List[dict[str, Any]]]:
        """
        Generate a standards-compliant multi-page vector `.PDF` (`%PDF-1.4`) for `En rollo`
        multi-design production (`separate_artboards`):
        - Each design is placed on its OWN separate page/artboard (`/Type /Page`) sized to
          `(width_cm + 2*margin_cm, height_cm + 2*margin_cm)`.
        - Layer 1 (`Capa 1 - Diseno`): embeds the lossless Flate-compressed 300 DPI enhanced image.
        - Layer 2 (`Capa 2 - CutContour`): strokes the exact closed cubic Bezier `CutContour`
          vector path in Magenta CMYK `0 1 0 0 K` aligned 1:1 with Layer 1.
        """
        import zlib

        if not prepared_designs:
            raise ValueError("Se requiere al menos un diseño para exportar el PDF multi-página.")

        safe_margin_cm = max(0.0, float(margin_cm))
        margin_pt = safe_margin_cm * PT_PER_CM
        safe_stroke_pt = max(0.1, min(5.0, float(cut_stroke_width_pt)))

        objects: List[bytes] = []

        def _add_obj(body: bytes) -> int:
            objects.append(body)
            return len(objects)

        # Object 1: Catalog (placeholder, updated once Pages & OCGs are allocated)
        _add_obj(b"")
        # Object 2: Pages root (placeholder)
        _add_obj(b"")
        # Object 3 & 4: Optional Content Groups (PDF Layers) for Illustrator / Acrobat
        ocg_layer1_id = _add_obj(b"<< /Type /OCG /Name (Capa 1 - Diseno) >>")
        ocg_layer2_id = _add_obj(b"<< /Type /OCG /Name (Capa 2 - CutContour) >>")

        page_obj_ids: List[int] = []
        artboards_meta: List[dict[str, Any]] = []

        for idx, d in enumerate(prepared_designs, start=1):
            crop_w = int(d["crop_w_px"])
            crop_h = int(d["crop_h_px"])
            w_cm = float(d["width_cm"])
            h_cm = float(d["height_cm"])
            w_pt = w_cm * PT_PER_CM
            h_pt = h_cm * PT_PER_CM

            page_w_pt = w_pt + 2.0 * margin_pt
            page_h_pt = h_pt + 2.0 * margin_pt

            if d.get("fit_mode") == "exact_stretch":
                scale_x = w_pt / float(crop_w)
                scale_y = h_pt / float(crop_h)
            else:
                scale_pt = min(w_pt / float(crop_w), h_pt / float(crop_h))
                scale_x = scale_pt
                scale_y = scale_pt

            draw_w_pt = float(crop_w) * scale_x
            draw_h_pt = float(crop_h) * scale_y
            ox_pt = margin_pt + (w_pt - draw_w_pt) * 0.5
            oy_bot_pt = margin_pt + (h_pt - draw_h_pt) * 0.5
            oy_top_pt = oy_bot_pt + draw_h_pt

            # Compress white-composited RGB enhanced pixels losslessly with zlib
            raw_rgb_bytes = d["comp_rgb_u8"].tobytes()
            compressed_img = zlib.compress(raw_rgb_bytes, level=6)
            img_header = (
                f"<< /Type /XObject /Subtype /Image /Width {crop_w} /Height {crop_h} "
                f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode "
                f"/Length {len(compressed_img)} >>\nstream\n"
            ).encode("ascii")
            img_obj_id = _add_obj(img_header + compressed_img + b"\nendstream")

            # Build vector cubic Bezier CutContour stream in PDF coordinate space
            anchors: List[BezierAnchor] = d["anchors"]

            def _to_pdf_xy(px_x: float, px_y: float) -> Tuple[float, float]:
                px_x_f = float(px_x) if math.isfinite(px_x) else 0.0
                px_y_f = float(px_y) if math.isfinite(px_y) else 0.0
                x_pt = max(0.0, min(page_w_pt, ox_pt + px_x_f * scale_x))
                y_pt = max(0.0, min(page_h_pt, oy_top_pt - px_y_f * scale_y))
                return x_pt, y_pt

            first_x, first_y = _to_pdf_xy(anchors[0].x, anchors[0].y)
            path_cmds = [f"{first_x:.3f} {first_y:.3f} m"]
            n_anc = len(anchors)
            for i in range(n_anc):
                curr = anchors[i]
                nxt = anchors[(i + 1) % n_anc]
                c1x, c1y = _to_pdf_xy(curr.out_x, curr.out_y)
                c2x, c2y = _to_pdf_xy(nxt.in_x, nxt.in_y)
                nx, ny = _to_pdf_xy(nxt.x, nxt.y)
                path_cmds.append(
                    f"{c1x:.3f} {c1y:.3f} {c2x:.3f} {c2y:.3f} {nx:.3f} {ny:.3f} c"
                )
            path_cmds.append("h S")
            cut_stream_str = "\n".join(path_cmds)

            content_lines = [
                f"% Artboard #{idx:02d}: {d['label']}",
                "/OC /OC1 BDC",
                "q",
                f"{draw_w_pt:.4f} 0 0 {draw_h_pt:.4f} {ox_pt:.4f} {oy_bot_pt:.4f} cm",
                f"/Im{idx} Do",
                "Q",
                "EMC",
                "/OC /OC2 BDC",
                "q",
                "0.000 1.000 0.000 0.000 K",
                f"{safe_stroke_pt:.2f} w 1 J 1 j",
                cut_stream_str,
                "Q",
                "EMC",
            ]
            content_bytes = "\n".join(content_lines).encode("ascii")
            content_obj_id = _add_obj(
                f"<< /Length {len(content_bytes)} >>\nstream\n".encode("ascii")
                + content_bytes
                + b"\nendstream"
            )

            page_dict = (
                f"<< /Type /Page /Parent 2 0 R "
                f"/MediaBox [0 0 {page_w_pt:.3f} {page_h_pt:.3f}] "
                f"/TrimBox [{margin_pt:.3f} {margin_pt:.3f} {margin_pt + w_pt:.3f} {margin_pt + h_pt:.3f}] "
                f"/Resources << "
                f"/XObject << /Im{idx} {img_obj_id} 0 R >> "
                f"/Properties << /OC1 {ocg_layer1_id} 0 R /OC2 {ocg_layer2_id} 0 R >> "
                f">> "
                f"/Contents {content_obj_id} 0 R >>"
            ).encode("ascii")
            page_id = _add_obj(page_dict)
            page_obj_ids.append(page_id)

            artboards_meta.append(
                {
                    "page_index": idx,
                    "item_id": d["item_id"],
                    "width_cm": round(w_cm, 2),
                    "height_cm": round(h_cm, 2),
                    "page_width_pt": round(page_w_pt, 3),
                    "page_height_pt": round(page_h_pt, 3),
                }
            )

        kids_str = " ".join(f"{pid} 0 R" for pid in page_obj_ids)
        objects[1] = f"<< /Type /Pages /Kids [{kids_str}] /Count {len(page_obj_ids)} >>".encode(
            "ascii"
        )
        objects[0] = (
            f"<< /Type /Catalog /Pages 2 0 R "
            f"/OCProperties << /OCGs [{ocg_layer1_id} 0 R {ocg_layer2_id} 0 R] "
            f"/D << /Order [{ocg_layer1_id} 0 R {ocg_layer2_id} 0 R] /ON [{ocg_layer1_id} 0 R {ocg_layer2_id} 0 R] >> >> >>"
        ).encode("ascii")

        out = io.BytesIO()
        out.write(f"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n%Title: {title}\n".encode("latin1"))

        offsets: List[int] = [0]
        for obj_idx, obj_body in enumerate(objects, start=1):
            offsets.append(out.tell())
            out.write(f"{obj_idx} 0 obj\n".encode("ascii"))
            out.write(obj_body)
            out.write(b"\nendobj\n")

        xref_offset = out.tell()
        out.write(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
        out.write(b"0000000000 65535 f \n")
        for off in offsets[1:]:
            out.write(f"{off:010d} 00000 n \n".encode("ascii"))

        out.write(
            (
                f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
                f"startxref\n{xref_offset}\n%%EOF\n"
            ).encode("ascii")
        )
        return out.getvalue(), artboards_meta
