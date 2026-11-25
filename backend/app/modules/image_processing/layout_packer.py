"""
Phase 2 - Module 3 (Active): Optimal Sticker Sheet & Roll Layout Packer (2D MaxRects Nesting).

Pipeline:
1. Accepts physical sheet dimensions or continuous roll width in centimeters (`cm`),
   configurable plotter safety margin (default `2.0 cm` on all 4 sides for registration marks),
   and inter-sticker cutting gap (`gap_cm`, default `0.3 cm`).
2. Optionally groups order designs by material (`group_by_material=True`) so incompatible
   substrates (e.g., Vinilo Brillo vs. DTF UV) never share the same physical sheet or roll.
3. Executes an exact micrometer-quantized 2D MaxRects multi-strategy portfolio optimizer
   (BSSF, BAF, BLSF, Bottom-Left, and column-maximizing orientations) with 90° rotation
   support on rectangular designs to maximize material utilization and minimize sheet count.
4. Verifies geometrically via `shapely` (`shapely.geometry.box` + `STRtree`, with exact
   sweep-line analytical fallback if `shapely` is not installed) that NO sticker overlaps
   another, respects `gap_cm`, and NEVER invades the `margin_cm` safety border.
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Literal, Optional, Set, Tuple

from app.modules.image_processing.base import (
    BaseImageProcessor,
    MaterialLayoutGroup,
    PlacedSticker,
    SheetLayoutPage,
    SheetLayoutResult,
    SheetSpec,
    StickerNestItem,
    check_phase2_dependencies,
)

UNIT_SCALE = 10_000  # 1 internal integer unit = 0.0001 cm = 1 micrometer
MAX_TOTAL_STICKER_INSTANCES = 5_000

HeuristicName = Literal["bssf", "baf", "blsf", "bl", "bl_narrow"]
OrientationPref = Literal["free", "prefer_wide", "prefer_tall"]
SortOrderName = Literal["area_desc", "max_side_desc", "perimeter_desc", "width_desc", "height_desc"]


@dataclass(frozen=True)
class LayoutPackPayload:
    sheet: SheetSpec
    items: List[StickerNestItem]


@dataclass(frozen=True)
class _StickerInstanceU:
    """Expanded single sticker copy converted to exact integer micrometer units."""

    instance_idx: int
    item_id: str
    order_id: Optional[str]
    material: str
    shape: str
    label: Optional[str]
    copy_index: int
    w_u: int
    h_u: int
    can_rotate: bool


@dataclass(frozen=True)
class _PlacedInstanceU:
    """Placed sticker in virtual bin coordinates (integer micrometer units)."""

    instance: _StickerInstanceU
    vx_u: int
    vy_u: int
    w_u: int
    h_u: int
    rotated: bool


class _MaxRectsBin:
    """Single 2D MaxRects bin operating in exact integer micrometer coordinates."""

    __slots__ = ("bin_w_u", "bin_h_u", "gap_u", "free_rects", "placements", "unfit_keys")

    def __init__(self, bin_w_u: int, bin_h_u: int, gap_u: int) -> None:
        self.bin_w_u = bin_w_u
        self.bin_h_u = bin_h_u
        self.gap_u = gap_u
        self.free_rects: List[Tuple[int, int, int, int]] = [(0, 0, bin_w_u, bin_h_u)]
        self.placements: List[_PlacedInstanceU] = []
        self.unfit_keys: Set[Tuple[int, int, bool, OrientationPref]] = set()

    def find_best_candidate(
        self,
        inst: _StickerInstanceU,
        heuristic: HeuristicName,
        orientation_pref: OrientationPref = "free",
    ) -> Optional[Tuple[Tuple[int, ...], int, int, int, int, bool]]:
        """
        Return `(score_tuple, vx_u, vy_u, real_w_u, real_h_u, rotated)` for the best free rectangle,
        or `None` if `inst` cannot fit anywhere in this bin.
        """
        cache_key = (inst.w_u, inst.h_u, inst.can_rotate, orientation_pref)
        if cache_key in self.unfit_keys:
            return None

        gap_u = self.gap_u
        orientations: List[Tuple[int, int, bool, int]] = []

        w0, h0 = inst.w_u, inst.h_u
        if inst.can_rotate and w0 != h0:
            if orientation_pref == "prefer_wide":
                if w0 >= h0:
                    orientations.append((w0, h0, False, 0))
                    orientations.append((h0, w0, True, 1))
                else:
                    orientations.append((h0, w0, True, 0))
                    orientations.append((w0, h0, False, 1))
            elif orientation_pref == "prefer_tall":
                if h0 >= w0:
                    orientations.append((w0, h0, False, 0))
                    orientations.append((h0, w0, True, 1))
                else:
                    orientations.append((h0, w0, True, 0))
                    orientations.append((w0, h0, False, 1))
            else:
                orientations.append((w0, h0, False, 0))
                orientations.append((h0, w0, True, 0))
        else:
            orientations.append((w0, h0, False, 0))

        best: Optional[Tuple[Tuple[int, ...], int, int, int, int, bool]] = None

        for real_w, real_h, rotated, pref_penalty in orientations:
            pw = real_w + gap_u
            ph = real_h + gap_u
            for fx, fy, fw, fh in self.free_rects:
                if pw <= fw and ph <= fh:
                    rem_w = fw - pw
                    rem_h = fh - ph
                    short_fit = rem_w if rem_w < rem_h else rem_h
                    long_fit = rem_h if rem_w < rem_h else rem_w

                    if heuristic == "bssf":
                        score = (pref_penalty, short_fit, long_fit, fy, fx)
                    elif heuristic == "blsf":
                        score = (pref_penalty, long_fit, short_fit, fy, fx)
                    elif heuristic == "baf":
                        area_fit = fw * fh - pw * ph
                        score = (pref_penalty, area_fit, short_fit, fy, fx)
                    elif heuristic == "bl_narrow":
                        score = (pref_penalty, fy, fx, pw, ph)
                    else:  # "bl"
                        score = (pref_penalty, fy + real_h, fy, fx, short_fit)

                    if best is None or score < best[0]:
                        best = (score, fx, fy, real_w, real_h, rotated)

        if best is None:
            self.unfit_keys.add(cache_key)
        return best

    def place(
        self,
        inst: _StickerInstanceU,
        vx_u: int,
        vy_u: int,
        real_w_u: int,
        real_h_u: int,
        rotated: bool,
    ) -> None:
        """Commit placement and split/prune intersecting maximal free rectangles."""
        pw = real_w_u + self.gap_u
        ph = real_h_u + self.gap_u
        px2 = vx_u + pw
        py2 = vy_u + ph

        next_free: List[Tuple[int, int, int, int]] = []
        for fx, fy, fw, fh in self.free_rects:
            fx2 = fx + fw
            fy2 = fy + fh
            if vx_u >= fx2 or px2 <= fx or vy_u >= fy2 or py2 <= fy:
                next_free.append((fx, fy, fw, fh))
                continue

            if vy_u > fy:
                next_free.append((fx, fy, fw, vy_u - fy))
            if py2 < fy2:
                next_free.append((fx, py2, fw, fy2 - py2))
            if vx_u > fx:
                next_free.append((fx, fy, vx_u - fx, fh))
            if px2 < fx2:
                next_free.append((px2, fy, fx2 - px2, fh))

        self.free_rects = _prune_free_rects(next_free)
        self.placements.append(
            _PlacedInstanceU(
                instance=inst,
                vx_u=vx_u,
                vy_u=vy_u,
                w_u=real_w_u,
                h_u=real_h_u,
                rotated=rotated,
            )
        )


def _cm_to_units(value_cm: float) -> int:
    dec = Decimal(str(round(float(value_cm), 4)))
    return int((dec * UNIT_SCALE).to_integral_value(rounding=ROUND_HALF_UP))


def _units_to_cm(units: int) -> float:
    return round(units / UNIT_SCALE, 4)


def _prune_free_rects(
    free_rects: List[Tuple[int, int, int, int]],
) -> List[Tuple[int, int, int, int]]:
    """
    Remove any free rectangle that is completely covered by another free rectangle.
    Sorting by descending area ensures containing rectangles are always visited first.
    """
    if len(free_rects) <= 1:
        return free_rects
    free_rects.sort(key=lambda r: (r[2] * r[3], r[3], r[2]), reverse=True)
    kept: List[Tuple[int, int, int, int]] = []
    for ax, ay, aw, ah in free_rects:
        ax2 = ax + aw
        ay2 = ay + ah
        contained = False
        for bx, by, bw, bh in kept:
            if bx <= ax and by <= ay and (bx + bw) >= ax2 and (by + bh) >= ay2:
                contained = True
                break
        if not contained:
            kept.append((ax, ay, aw, ah))
    return kept


def _can_item_rotate(item: StickerNestItem) -> bool:
    """
    Determine whether 90-degree rotation should be evaluated for `item`.
    Circular and square stickers have identical width and height, so rotation is disabled
    to keep `rotated=False` deterministic. Rectangular designs default to `True`.
    """
    if abs(float(item.width_cm) - float(item.height_cm)) < 1e-6:
        return False
    if item.shape in ("Circular", "Cuadrado"):
        return False
    if item.allow_rotation is not None:
        return bool(item.allow_rotation)
    return True


def _sort_instances(
    instances: List[_StickerInstanceU],
    order: SortOrderName,
) -> List[_StickerInstanceU]:
    if order == "area_desc":
        return sorted(
            instances,
            key=lambda it: (-(it.w_u * it.h_u), -max(it.w_u, it.h_u), it.instance_idx),
        )
    if order == "max_side_desc":
        return sorted(
            instances,
            key=lambda it: (-max(it.w_u, it.h_u), -(it.w_u * it.h_u), it.instance_idx),
        )
    if order == "perimeter_desc":
        return sorted(
            instances,
            key=lambda it: (-(it.w_u + it.h_u), -(it.w_u * it.h_u), it.instance_idx),
        )
    if order == "width_desc":
        return sorted(
            instances,
            key=lambda it: (-it.w_u, -it.h_u, it.instance_idx),
        )
    return sorted(
        instances,
        key=lambda it: (-it.h_u, -it.w_u, it.instance_idx),
    )


def _run_maxrects_strategy(
    instances: List[_StickerInstanceU],
    *,
    bin_w_u: int,
    bin_h_u: int,
    gap_u: int,
    heuristic: HeuristicName,
    sort_order: SortOrderName,
    orientation_pref: OrientationPref = "free",
) -> List[_MaxRectsBin]:
    ordered = _sort_instances(instances, sort_order)
    bins: List[_MaxRectsBin] = []

    for inst in ordered:
        best_bin_idx = -1
        best_cand: Optional[Tuple[Tuple[int, ...], int, int, int, int, bool]] = None

        for b_idx, b in enumerate(bins):
            cand = b.find_best_candidate(inst, heuristic, orientation_pref)
            if cand is not None:
                if best_cand is None or cand[0] < best_cand[0]:
                    best_cand = cand
                    best_bin_idx = b_idx

        if best_cand is not None and best_bin_idx >= 0:
            _, vx, vy, rw, rh, rot = best_cand
            bins[best_bin_idx].place(inst, vx, vy, rw, rh, rot)
        else:
            new_bin = _MaxRectsBin(bin_w_u, bin_h_u, gap_u)
            cand = new_bin.find_best_candidate(inst, heuristic, orientation_pref)
            if cand is None:
                raise ValueError(
                    f"El diseño '{inst.item_id}' ({_units_to_cm(inst.w_u)}x{_units_to_cm(inst.h_u)} cm) "
                    "no cabe dentro del área imprimible disponible."
                )
            _, vx, vy, rw, rh, rot = cand
            new_bin.place(inst, vx, vy, rw, rh, rot)
            bins.append(new_bin)

    return bins


def _pack_material_instances(
    instances: List[_StickerInstanceU],
    *,
    usable_w_u: int,
    usable_h_u: Optional[int],
    gap_u: int,
    is_roll_unbounded: bool,
) -> List[_MaxRectsBin]:
    """Evaluate a portfolio of MaxRects strategies and return the highest-utilization bin layout."""
    bin_w_u = usable_w_u + gap_u
    if is_roll_unbounded or usable_h_u is None:
        max_stack_h_u = sum(max(it.w_u, it.h_u) + gap_u for it in instances) + gap_u
        bin_h_u = max(usable_w_u * 4, max_stack_h_u)
    else:
        bin_h_u = usable_h_u + gap_u

    has_rotatable = any(it.can_rotate for it in instances)
    n_inst = len(instances)

    if is_roll_unbounded:
        strategies: List[Tuple[HeuristicName, SortOrderName, OrientationPref]] = [
            ("bl", "max_side_desc", "free"),
            ("bl", "area_desc", "free"),
            ("bl_narrow", "area_desc", "prefer_tall"),
            ("bl", "area_desc", "prefer_wide"),
            ("bssf", "area_desc", "free"),
        ]
    else:
        strategies = [
            ("bssf", "area_desc", "free"),
            ("bssf", "max_side_desc", "free"),
            ("baf", "area_desc", "free"),
            ("blsf", "perimeter_desc", "free"),
            ("bl", "max_side_desc", "free"),
        ]
        if has_rotatable:
            strategies.append(("bssf", "area_desc", "prefer_wide"))
            strategies.append(("bssf", "area_desc", "prefer_tall"))
            strategies.append(("bl_narrow", "max_side_desc", "prefer_tall"))

    if n_inst > 800:
        strategies = strategies[:3]

    best_bins: Optional[List[_MaxRectsBin]] = None
    best_rank: Optional[Tuple[int, ...]] = None

    for heuristic, sort_order, orient_pref in strategies:
        candidate_bins = _run_maxrects_strategy(
            instances,
            bin_w_u=bin_w_u,
            bin_h_u=bin_h_u,
            gap_u=gap_u,
            heuristic=heuristic,
            sort_order=sort_order,
            orientation_pref=orient_pref,
        )
        if not candidate_bins:
            continue

        last_bin = candidate_bins[-1]
        last_used_h_u = max((p.vy_u + p.h_u for p in last_bin.placements), default=0)
        max_used_h_u = max(
            (max((p.vy_u + p.h_u for p in b.placements), default=0) for b in candidate_bins),
            default=0,
        )
        coord_compactness = sum(
            p.vy_u * 2 + p.vx_u for b in candidate_bins for p in b.placements
        )

        if is_roll_unbounded:
            rank = (len(candidate_bins), max_used_h_u, coord_compactness)
        else:
            rank = (len(candidate_bins), last_used_h_u, max_used_h_u, coord_compactness)

        if best_rank is None or rank < best_rank:
            best_rank = rank
            best_bins = candidate_bins

    assert best_bins is not None
    return best_bins


def verify_sheet_geometry(
    sheet: SheetLayoutPage,
    *,
    margin_cm: float,
    gap_cm: float,
    eps: float = 1e-5,
) -> Literal["shapely", "analytical"]:
    """
    Verify geometrically that every placed sticker on `sheet`:
    1. Lies strictly inside the printable area `[margin_cm, width_cm - margin_cm] x [margin_cm, height_cm - margin_cm]`
       (never invading the safety margin reserved for plotter registration marks).
    2. Never overlaps any other sticker on the same sheet and maintains at least `gap_cm` separation.

    Uses `shapely` (`shapely.geometry.box` + `STRtree`) when installed, falling back to an
    exact analytical sweep-line verifier when `shapely` is not present in the runtime.
    """
    min_x = margin_cm - eps
    min_y = margin_cm - eps
    max_x = sheet.width_cm - margin_cm + eps
    max_y = sheet.height_cm - margin_cm + eps

    deps = check_phase2_dependencies()
    if deps.get("shapely", False):
        from shapely.geometry import box
        from shapely.strtree import STRtree

        printable_poly = box(min_x, min_y, max_x, max_y)
        polys = []
        for p in sheet.placements:
            if p.width <= 0 or p.height <= 0:
                raise ValueError(f"Sticker '{p.item_id}' tiene dimensiones no positivas.")
            poly = box(p.x, p.y, p.x + p.width, p.y + p.height)
            if not printable_poly.covers(poly):
                raise ValueError(
                    f"Sticker '{p.item_id}' en ({p.x}, {p.y}, {p.width}x{p.height} cm) "
                    f"invade el margen de seguridad ({margin_cm} cm) del pliego #{sheet.sheet_index}."
                )
            polys.append(poly)

        if len(polys) > 1:
            tree = STRtree(polys)
            min_sep = max(0.0, gap_cm - eps)
            for idx, poly in enumerate(polys):
                search_env = poly.buffer(gap_cm + eps) if gap_cm > 0 else poly
                candidate_indices = tree.query(search_env)
                for other_idx in candidate_indices:
                    j = int(other_idx)
                    if j <= idx:
                        continue
                    other = polys[j]
                    inter_area = poly.intersection(other).area
                    if inter_area > 1e-7:
                        raise ValueError(
                            f"Solapamiento detectado en pliego #{sheet.sheet_index} entre "
                            f"stickers '{sheet.placements[idx].item_id}' y '{sheet.placements[j].item_id}'."
                        )
                    if min_sep > 0 and poly.distance(other) < min_sep:
                        raise ValueError(
                            f"Separación insuficiente (< {gap_cm} cm) en pliego #{sheet.sheet_index} "
                            f"entre '{sheet.placements[idx].item_id}' y '{sheet.placements[j].item_id}'."
                        )
        return "shapely"

    for p in sheet.placements:
        if p.width <= 0 or p.height <= 0:
            raise ValueError(f"Sticker '{p.item_id}' tiene dimensiones no positivas.")
        if (
            p.x < min_x
            or p.y < min_y
            or (p.x + p.width) > max_x
            or (p.y + p.height) > max_y
        ):
            raise ValueError(
                f"Sticker '{p.item_id}' en ({p.x}, {p.y}, {p.width}x{p.height} cm) "
                f"invade el margen de seguridad ({margin_cm} cm) del pliego #{sheet.sheet_index}."
            )

    indexed = sorted(enumerate(sheet.placements), key=lambda pair: (pair[1].x, pair[1].y))
    n = len(indexed)
    for a_pos in range(n):
        idx_a, pa = indexed[a_pos]
        ax2 = pa.x + pa.width
        ay2 = pa.y + pa.height
        for b_pos in range(a_pos + 1, n):
            idx_b, pb = indexed[b_pos]
            if pb.x >= ax2 + gap_cm - eps:
                break
            bx2 = pb.x + pb.width
            by2 = pb.y + pb.height

            overlap_x = min(ax2, bx2) - max(pa.x, pb.x)
            overlap_y = min(ay2, by2) - max(pa.y, pb.y)
            if overlap_x > eps and overlap_y > eps:
                raise ValueError(
                    f"Solapamiento detectado en pliego #{sheet.sheet_index} entre "
                    f"stickers #{idx_a} ('{pa.item_id}') y #{idx_b} ('{pb.item_id}')."
                )

            if gap_cm > 0:
                dx = max(0.0, max(pa.x - bx2, pb.x - ax2))
                dy = max(0.0, max(pa.y - by2, pb.y - ay2))
                if dx < (gap_cm - eps) and dy < (gap_cm - eps):
                    raise ValueError(
                        f"Separación insuficiente (< {gap_cm} cm) en pliego #{sheet.sheet_index} "
                        f"entre '{pa.item_id}' y '{pb.item_id}'."
                    )

    return "analytical"


def _render_layout_preview_svg(
    sheets: List[SheetLayoutPage],
    *,
    margin_cm: float,
) -> str:
    """Render a lightweight vector SVG diagram of packed sheets with plotter registration marks."""
    if not sheets:
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>'

    scale = 10.0  # 10 SVG units per cm (1 unit = 1 mm)
    pad = 20.0
    max_w = max(s.width_cm * scale for s in sheets) + pad * 2
    total_h = sum(s.height_cm * scale + pad for s in sheets) + pad

    parts: List[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {max_w:.1f} {total_h:.1f}" '
        'font-family="monospace" font-size="9">'
    ]
    cursor_y = pad
    m_svg = margin_cm * scale
    reg_size = min(8.0, max(3.0, m_svg * 0.45))

    for sheet in sheets:
        sw = sheet.width_cm * scale
        sh = sheet.height_cm * scale
        ox = pad
        oy = cursor_y

        parts.append(
            f'<rect x="{ox:.1f}" y="{oy:.1f}" width="{sw:.1f}" height="{sh:.1f}" '
            'fill="#ffffff" stroke="#1e293b" stroke-width="1.5"/>'
        )
        if margin_cm > 0:
            parts.append(
                f'<rect x="{ox + m_svg:.1f}" y="{oy + m_svg:.1f}" '
                f'width="{max(0.0, sw - 2 * m_svg):.1f}" height="{max(0.0, sh - 2 * m_svg):.1f}" '
                'fill="none" stroke="#ef4444" stroke-dasharray="4 3" stroke-width="0.9"/>'
            )
            for rx, ry in (
                (ox + m_svg * 0.5, oy + m_svg * 0.5),
                (ox + sw - m_svg * 0.5, oy + m_svg * 0.5),
                (ox + m_svg * 0.5, oy + sh - m_svg * 0.5),
                (ox + sw - m_svg * 0.5, oy + sh - m_svg * 0.5),
            ):
                parts.append(
                    f'<circle cx="{rx:.1f}" cy="{ry:.1f}" r="{reg_size * 0.45:.1f}" '
                    'fill="none" stroke="#0f172a" stroke-width="0.9"/>'
                )

        for p in sheet.placements:
            px = ox + p.x * scale
            py = oy + p.y * scale
            pw = p.width * scale
            ph = p.height * scale
            fill = "#dbeafe" if not p.rotated else "#dcfce7"
            stroke = "#2563eb" if not p.rotated else "#16a34a"
            parts.append(
                f'<rect x="{px:.2f}" y="{py:.2f}" width="{pw:.2f}" height="{ph:.2f}" '
                f'fill="{fill}" stroke="{stroke}" stroke-width="0.8"/>'
            )

        cursor_y += sh + pad

    parts.append("</svg>")
    return "".join(parts)


class SheetLayoutPackerService(BaseImageProcessor[LayoutPackPayload, SheetLayoutResult]):
    """Packs multiple sticker designs onto print sheets or vinyl rolls maximizing area utilization."""

    module_name = "sheet_layout_packer"

    def is_available(self) -> bool:
        deps = check_phase2_dependencies()
        return deps["numpy"]

    async def process(self, payload: LayoutPackPayload) -> SheetLayoutResult:
        return self.pack(payload)

    def pack(self, payload: LayoutPackPayload) -> SheetLayoutResult:
        sheet_spec = payload.sheet
        items = payload.items

        if not items:
            raise ValueError("Debes incluir al menos un diseño de sticker para calcular el pliego.")

        width_cm = float(sheet_spec.width_cm)
        margin_cm = float(sheet_spec.margin_cm)
        gap_cm = float(sheet_spec.gap_cm)
        media_type = sheet_spec.media_type

        if width_cm <= 0:
            raise ValueError("El ancho del pliego o rollo debe ser mayor a 0 cm.")
        if margin_cm < 0:
            raise ValueError("El margen de seguridad no puede ser negativo.")
        if gap_cm < 0:
            raise ValueError("La separación entre stickers (gap_cm) no puede ser negativa.")

        width_u = _cm_to_units(width_cm)
        margin_u = _cm_to_units(margin_cm)
        gap_u = _cm_to_units(gap_cm)
        usable_w_u = width_u - 2 * margin_u

        if usable_w_u <= 0:
            raise ValueError(
                f"El margen de seguridad ({margin_cm} cm por lado = {2 * margin_cm} cm) "
                f"supera o iguala el ancho del pliego/rollo ({width_cm} cm)."
            )

        is_roll_unbounded = media_type == "roll" and sheet_spec.height_cm is None
        usable_h_u: Optional[int] = None
        fixed_height_cm: Optional[float] = None

        if not is_roll_unbounded:
            if sheet_spec.height_cm is None or float(sheet_spec.height_cm) <= 0:
                raise ValueError(
                    "Para distribución en pliego fijo debes especificar un alto de pliego (`sheet_height_cm` > 0)."
                )
            fixed_height_cm = float(sheet_spec.height_cm)
            height_u = _cm_to_units(fixed_height_cm)
            usable_h_u = height_u - 2 * margin_u
            if usable_h_u <= 0:
                raise ValueError(
                    f"El margen de seguridad ({margin_cm} cm por lado = {2 * margin_cm} cm) "
                    f"supera o iguala el alto del pliego ({fixed_height_cm} cm)."
                )

        usable_w_cm = _units_to_cm(usable_w_u)
        usable_h_cm = _units_to_cm(usable_h_u) if usable_h_u is not None else None

        total_requested = sum(int(it.quantity) for it in items)
        if total_requested <= 0:
            raise ValueError("La cantidad total de stickers a distribuir debe ser al menos 1.")
        if total_requested > MAX_TOTAL_STICKER_INSTANCES:
            raise ValueError(
                f"El cálculo por lote admite hasta {MAX_TOTAL_STICKER_INSTANCES:,} stickers individuales "
                f"(recibidos: {total_requested:,})."
            )

        grouped_items: "OrderedDict[str, List[StickerNestItem]]" = OrderedDict()
        for item in items:
            if item.quantity <= 0:
                raise ValueError(f"El diseño '{item.item_id}' debe tener cantidad >= 1.")
            if item.width_cm <= 0 or item.height_cm <= 0:
                raise ValueError(
                    f"El diseño '{item.item_id}' debe tener dimensiones físicas mayores a 0 cm."
                )

            w_u = _cm_to_units(item.width_cm)
            h_u = _cm_to_units(item.height_cm)
            can_rot = _can_item_rotate(item)

            fits_normal = w_u <= usable_w_u and (usable_h_u is None or h_u <= usable_h_u)
            fits_rotated = can_rot and h_u <= usable_w_u and (usable_h_u is None or w_u <= usable_h_u)
            if not (fits_normal or fits_rotated):
                printable_desc = (
                    f"{usable_w_cm}x{usable_h_cm} cm"
                    if usable_h_cm is not None
                    else f"{usable_w_cm} cm de ancho útil"
                )
                raise ValueError(
                    f"El diseño '{item.item_id}' ({item.width_cm}x{item.height_cm} cm) "
                    f"supera el área imprimible descontando márgenes de seguridad ({printable_desc})."
                )

            mat_key = (item.material or "General").strip() or "General"
            if not sheet_spec.group_by_material:
                mat_key = "General"
            grouped_items.setdefault(mat_key, []).append(item)

        if not sheet_spec.group_by_material and len(grouped_items) == 1:
            distinct_mats = {
                (it.material or "General").strip() or "General" for it in items
            }
            if len(distinct_mats) == 1:
                only_mat = next(iter(distinct_mats))
                grouped_items = OrderedDict([(only_mat, items)])
            else:
                grouped_items = OrderedDict([("Mixto", items)])

        all_sheets: List[SheetLayoutPage] = []
        all_placements: List[PlacedSticker] = []
        material_groups: List[MaterialLayoutGroup] = []
        global_sheet_idx = 0
        geometry_engine: Literal["shapely", "analytical"] = "analytical"

        for mat_name, mat_items in grouped_items.items():
            instances: List[_StickerInstanceU] = []
            inst_counter = 0
            for item in mat_items:
                w_u = _cm_to_units(item.width_cm)
                h_u = _cm_to_units(item.height_cm)
                can_rot = _can_item_rotate(item)
                for copy_idx in range(1, int(item.quantity) + 1):
                    inst_counter += 1
                    instances.append(
                        _StickerInstanceU(
                            instance_idx=inst_counter,
                            item_id=str(item.item_id),
                            order_id=item.order_id,
                            material=mat_name,
                            shape=item.shape,
                            label=item.label,
                            copy_index=copy_idx,
                            w_u=w_u,
                            h_u=h_u,
                            can_rotate=can_rot,
                        )
                    )

            packed_bins = _pack_material_instances(
                instances,
                usable_w_u=usable_w_u,
                usable_h_u=usable_h_u,
                gap_u=gap_u,
                is_roll_unbounded=is_roll_unbounded,
            )

            mat_sheet_indices: List[int] = []
            mat_stickers_area = 0.0
            mat_total_sheet_area = 0.0
            mat_stickers_count = 0

            for mat_sheet_idx, b in enumerate(packed_bins, start=1):
                global_sheet_idx += 1
                mat_sheet_indices.append(global_sheet_idx)

                max_content_bottom_u = max((p.vy_u + p.h_u for p in b.placements), default=0)
                used_height_u = margin_u + max_content_bottom_u + margin_u
                used_height_cm = _units_to_cm(used_height_u)

                if media_type == "roll" or fixed_height_cm is None:
                    page_height_cm = used_height_cm
                    page_usable_h_cm = _units_to_cm(max_content_bottom_u)
                else:
                    page_height_cm = fixed_height_cm
                    page_usable_h_cm = usable_h_cm or _units_to_cm(max_content_bottom_u)

                sorted_bin_placements = sorted(
                    b.placements,
                    key=lambda p: (p.vy_u, p.vx_u, p.instance.instance_idx),
                )

                page_placements: List[PlacedSticker] = []
                page_stickers_area = 0.0
                for p in sorted_bin_placements:
                    x_cm = _units_to_cm(margin_u + p.vx_u)
                    y_cm = _units_to_cm(margin_u + p.vy_u)
                    w_cm = _units_to_cm(p.w_u)
                    h_cm = _units_to_cm(p.h_u)
                    page_stickers_area += w_cm * h_cm

                    placed_obj = PlacedSticker(
                        item_id=p.instance.item_id,
                        x=x_cm,
                        y=y_cm,
                        width=w_cm,
                        height=h_cm,
                        rotated=p.rotated,
                        sheet_index=global_sheet_idx,
                        order_id=p.instance.order_id,
                        material=mat_name,
                        shape=p.instance.shape,  # type: ignore[arg-type]
                        label=p.instance.label,
                        copy_index=p.instance.copy_index,
                    )
                    page_placements.append(placed_obj)
                    all_placements.append(placed_obj)

                page_stickers_area = round(page_stickers_area, 4)
                page_sheet_area = round(width_cm * page_height_cm, 4)
                page_usable_area = round(usable_w_cm * page_usable_h_cm, 4)

                page_util = (
                    round(min(100.0, (page_stickers_area / page_sheet_area) * 100.0), 2)
                    if page_sheet_area > 0
                    else 0.0
                )
                page_waste = round(max(0.0, 100.0 - page_util), 2)
                page_usable_util = (
                    round(min(100.0, (page_stickers_area / page_usable_area) * 100.0), 2)
                    if page_usable_area > 0
                    else 0.0
                )

                page_obj = SheetLayoutPage(
                    sheet_index=global_sheet_idx,
                    material=mat_name,
                    material_sheet_index=mat_sheet_idx,
                    width_cm=width_cm,
                    height_cm=page_height_cm,
                    used_height_cm=used_height_cm,
                    stickers_count=len(page_placements),
                    stickers_area_cm2=page_stickers_area,
                    sheet_area_cm2=page_sheet_area,
                    usable_area_cm2=page_usable_area,
                    utilization_percent=page_util,
                    waste_percent=page_waste,
                    usable_utilization_percent=page_usable_util,
                    placements=page_placements,
                )
                geometry_engine = verify_sheet_geometry(
                    page_obj,
                    margin_cm=margin_cm,
                    gap_cm=gap_cm,
                )
                all_sheets.append(page_obj)

                mat_stickers_area += page_stickers_area
                mat_total_sheet_area += page_sheet_area
                mat_stickers_count += len(page_placements)

            mat_util = (
                round(min(100.0, (mat_stickers_area / mat_total_sheet_area) * 100.0), 2)
                if mat_total_sheet_area > 0
                else 0.0
            )
            mat_waste = round(max(0.0, 100.0 - mat_util), 2)
            material_groups.append(
                MaterialLayoutGroup(
                    material=mat_name,
                    sheets_required=len(mat_sheet_indices),
                    stickers_count=mat_stickers_count,
                    stickers_area_cm2=round(mat_stickers_area, 4),
                    total_sheet_area_cm2=round(mat_total_sheet_area, 4),
                    utilization_percent=mat_util,
                    waste_percent=mat_waste,
                    sheet_indices=mat_sheet_indices,
                )
            )

        total_stickers_area = round(sum(s.stickers_area_cm2 for s in all_sheets), 4)
        total_sheet_area = round(sum(s.sheet_area_cm2 for s in all_sheets), 4)
        total_usable_area = round(sum(s.usable_area_cm2 for s in all_sheets), 4)

        overall_util = (
            round(min(100.0, (total_stickers_area / total_sheet_area) * 100.0), 2)
            if total_sheet_area > 0
            else 0.0
        )
        overall_waste = round(max(0.0, 100.0 - overall_util), 2)
        overall_usable_util = (
            round(min(100.0, (total_stickers_area / total_usable_area) * 100.0), 2)
            if total_usable_area > 0
            else 0.0
        )

        preview_svg = (
            _render_layout_preview_svg(all_sheets, margin_cm=margin_cm)
            if sheet_spec.include_preview_svg
            else None
        )

        return SheetLayoutResult(
            total_sheets=len(all_sheets),
            total_stickers=len(all_placements),
            utilization_percent=overall_util,
            waste_percent=overall_waste,
            usable_utilization_percent=overall_usable_util,
            total_stickers_area_cm2=total_stickers_area,
            total_sheet_area_cm2=total_sheet_area,
            total_usable_area_cm2=total_usable_area,
            sheet_width_cm=width_cm,
            sheet_height_cm=fixed_height_cm,
            media_type=media_type,
            margin_cm=margin_cm,
            gap_cm=gap_cm,
            usable_width_cm=usable_w_cm,
            usable_height_cm=usable_h_cm,
            group_by_material=sheet_spec.group_by_material,
            geometry_engine=geometry_engine,
            sheets=all_sheets,
            material_groups=material_groups,
            placements=all_placements,
            preview_svg=preview_svg,
        )
