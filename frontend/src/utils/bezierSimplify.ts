import type { BezierAnchor } from "@/types/order";

interface Point2D {
  x: number;
  y: number;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Evaluate a cubic Bézier curve at parameter t in [0, 1]. */
function evalCubic(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D, t: number): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
  };
}

/** Perpendicular distance from point P to segment AB. */
function perpendicularDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/** Standard open-polyline Ramer-Douglas-Peucker simplification. */
function rdpOpen(points: Point2D[], epsilon: number): Point2D[] {
  if (points.length <= 2) return points;

  const first = points[0];
  const last = points[points.length - 1];
  let maxDist = -1;
  let splitIndex = -1;

  for (let i = 1; i < points.length - 1; i += 1) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      splitIndex = i;
    }
  }

  if (maxDist > epsilon && splitIndex !== -1) {
    const left = rdpOpen(points.slice(0, splitIndex + 1), epsilon);
    const right = rdpOpen(points.slice(splitIndex), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

/** Closed-loop Ramer-Douglas-Peucker simplification splitting at the two farthest contour points. */
function rdpClosedLoop(points: Point2D[], epsilon: number): Point2D[] {
  const n = points.length;
  if (n <= 3) return points;

  // 1. Find point A furthest from centroid
  let cx = 0;
  let cy = 0;
  for (const pt of points) {
    cx += pt.x;
    cy += pt.y;
  }
  cx /= n;
  cy /= n;

  let idxA = 0;
  let maxDistA = -1;
  for (let i = 0; i < n; i += 1) {
    const d = (points[i].x - cx) ** 2 + (points[i].y - cy) ** 2;
    if (d > maxDistA) {
      maxDistA = d;
      idxA = i;
    }
  }

  // 2. Find point B furthest from point A
  let idxB = (idxA + Math.floor(n / 2)) % n;
  let maxDistB = -1;
  for (let i = 0; i < n; i += 1) {
    if (i === idxA) continue;
    const d = (points[i].x - points[idxA].x) ** 2 + (points[i].y - points[idxA].y) ** 2;
    if (d > maxDistB) {
      maxDistB = d;
      idxB = i;
    }
  }

  // Rotate array so idxA is at index 0
  const rotated: Point2D[] = [];
  for (let i = 0; i < n; i += 1) {
    rotated.push(points[(idxA + i) % n]);
  }
  const splitB = (idxB - idxA + n) % n;

  const arc1 = rotated.slice(0, splitB + 1);
  const arc2 = [...rotated.slice(splitB), rotated[0]];

  const simp1 = rdpOpen(arc1, epsilon);
  const simp2 = rdpOpen(arc2, epsilon);

  return [...simp1.slice(0, -1), ...simp2.slice(0, -1)];
}

/**
 * Sample the current closed cubic Bézier path into an ordered closed polyline.
 * Uses adaptive subdivisions per segment so curved shapes (circles, silhouettes, custom edits)
 * are faithfully represented before Ramer-Douglas-Peucker simplification.
 */
function sampleClosedBezierPath(anchors: BezierAnchor[]): {
  samples: Point2D[];
  diagonalPx: number;
} {
  const n = anchors.length;
  if (n === 0) return { samples: [], diagonalPx: 1 };

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  // Keep segments proportional to current anchor density so RDP never artificially inflates node count
  const stepsPerSegment = n <= 8 ? 3 : n <= 20 ? 2 : 1;
  const samples: Point2D[] = [];

  for (let i = 0; i < n; i += 1) {
    const a = anchors[i];
    const b = anchors[(i + 1) % n];
    const p0 = { x: a.x, y: a.y };
    const p1 = { x: a.out_x, y: a.out_y };
    const p2 = { x: b.in_x, y: b.in_y };
    const p3 = { x: b.x, y: b.y };

    const isCurved =
      Math.hypot(a.out_x - a.x, a.out_y - a.y) > 0.5 ||
      Math.hypot(b.in_x - b.x, b.in_y - b.y) > 0.5;
    const segSteps = isCurved ? stepsPerSegment : 1;

    for (let s = 0; s < segSteps; s += 1) {
      const pt = s === 0 ? p0 : evalCubic(p0, p1, p2, p3, s / segSteps);
      samples.push(pt);
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  const diagonalPx = Math.max(10, Math.hypot(maxX - minX, maxY - minY));
  return { samples, diagonalPx };
}

/**
 * Progressively decimate least-significant vertices in a closed loop until `points.length <= targetCount`
 * (minimum 3 vertices), guaranteeing monotonic node reduction for any shape preset.
 */
function decimateClosedLoopToMaxCount(points: Point2D[], targetCount: number): Point2D[] {
  const safeTarget = Math.max(3, targetCount);
  const current = [...points];

  while (current.length > safeTarget && current.length > 3) {
    const len = current.length;
    let minScore = Number.POSITIVE_INFINITY;
    let removeIdx = 0;

    for (let i = 0; i < len; i += 1) {
      const prev = current[(i - 1 + len) % len];
      const curr = current[i];
      const next = current[(i + 1) % len];
      // Combined perpendicular deviation & triangle area importance
      const perp = perpendicularDistance(curr, prev, next);
      const chord = Math.hypot(next.x - prev.x, next.y - prev.y);
      const score = perp * Math.sqrt(Math.max(1, chord));
      if (score < minScore) {
        minScore = score;
        removeIdx = i;
      }
    }

    current.splice(removeIdx, 1);
  }

  return current;
}

/** Compute smooth Catmull-Rom cubic Bézier tangent handles for a closed loop of 2D points. */
export function computeSmoothBezierAnchors(
  points: Point2D[],
  cornerRoundness = 0.65
): BezierAnchor[] {
  const n = points.length;
  if (n < 3) {
    return points.map((pt) => ({
      x: round2(pt.x),
      y: round2(pt.y),
      in_x: round2(pt.x),
      in_y: round2(pt.y),
      out_x: round2(pt.x),
      out_y: round2(pt.y),
      smooth: true,
    }));
  }

  // For very small node counts (3–5 nodes, e.g. circle/triangle/quad), use higher cubic kappa
  const baseTension = Math.max(0.12, Math.min(0.9, cornerRoundness)) * 0.45;
  const lowNodeBoost = n === 4 ? 0.36 : n <= 6 ? 0.32 : baseTension;
  const tension = Math.max(baseTension, lowNodeBoost);

  return points.map((curr, i) => {
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1 + n) % n];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const tLen = Math.hypot(tx, ty);
    const dPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const dNext = Math.hypot(next.x - curr.x, next.y - curr.y);

    if (tLen < 1e-5) {
      return {
        x: round2(curr.x),
        y: round2(curr.y),
        in_x: round2(curr.x),
        in_y: round2(curr.y),
        out_x: round2(curr.x),
        out_y: round2(curr.y),
        smooth: true,
      };
    }

    const ux = tx / tLen;
    const uy = ty / tLen;
    const inLen = Math.min(dPrev * tension, dPrev * 0.48);
    const outLen = Math.min(dNext * tension, dNext * 0.48);

    return {
      x: round2(curr.x),
      y: round2(curr.y),
      in_x: round2(curr.x - ux * inLen),
      in_y: round2(curr.y - uy * inLen),
      out_x: round2(curr.x + ux * outLen),
      out_y: round2(curr.y + uy * outLen),
      smooth: true,
    };
  });
}

/**
 * Simplify any closed cubic Bézier contour using Ramer-Douglas-Peucker + importance decimation
 * and recompute smooth cubic Bézier handles.
 *
 * @param anchors Current contour anchors (minimum 3)
 * @param intensityPercent Simplification strength from 0 to 100
 * @param cornerRoundness Smooth handle tension factor (0.1 to 1.0)
 */
export function simplifyBezierContour(
  anchors: BezierAnchor[],
  intensityPercent: number,
  cornerRoundness = 0.65
): BezierAnchor[] {
  const n = anchors.length;
  const clamped = Math.max(0, Math.min(100, intensityPercent));
  if (n <= 3 || clamped <= 0) {
    return anchors;
  }

  const norm = clamped / 100;
  const { samples, diagonalPx } = sampleClosedBezierPath(anchors);

  // Non-linear RDP tolerance scaled to the contour bounding-box diagonal
  const epsilon = diagonalPx * (0.0012 + 0.095 * Math.pow(norm, 1.55));
  const rdpPoints = rdpClosedLoop(samples, epsilon);

  // Upper bound on output nodes so any job (even 4-8 node presets) visibly simplifies as intensity increases
  const maxAllowedNodes = Math.max(
    3,
    Math.min(
      n - (clamped >= 15 && n > 3 ? 1 : 0),
      Math.round(n * (1 - 0.82 * Math.pow(norm, 0.88)))
    )
  );

  const simplifiedPoints = decimateClosedLoopToMaxCount(rdpPoints, maxAllowedNodes);
  return computeSmoothBezierAnchors(simplifiedPoints, cornerRoundness);
}

/** Preview the resulting node count (`Y`) for the "X nodos -> Y nodos" badge without mutating state. */
export function previewSimplifiedNodeCount(
  anchors: BezierAnchor[],
  intensityPercent: number,
  cornerRoundness = 0.65
): number {
  if (anchors.length <= 3 || intensityPercent <= 0) return anchors.length;
  return simplifyBezierContour(anchors, intensityPercent, cornerRoundness).length;
}

/**
 * Toggle a single anchor node between a smooth curve (with visible directional handles)
 * and a sharp corner (collapsed handles), or ensure visible handles when selecting a smooth node.
 */
export function toggleAnchorSmoothCorner(
  anchors: BezierAnchor[],
  index: number,
  cornerRoundness = 0.65
): BezierAnchor[] {
  const n = anchors.length;
  if (n < 3 || index < 0 || index >= n) return anchors;

  const target = anchors[index];
  const nextSmooth = !target.smooth;

  if (!nextSmooth) {
    // Convert to sharp corner node
    return anchors.map((pt, idx) =>
      idx === index
        ? {
            ...pt,
            in_x: pt.x,
            in_y: pt.y,
            out_x: pt.x,
            out_y: pt.y,
            smooth: false,
          }
        : pt
    );
  }

  // Convert to smooth curve node with freshly computed Catmull-Rom directional handles
  const prev = anchors[(index - 1 + n) % n];
  const next = anchors[(index + 1 + n) % n];
  const tx = next.x - prev.x;
  const ty = next.y - prev.y;
  const tLen = Math.hypot(tx, ty);
  const dPrev = Math.hypot(target.x - prev.x, target.y - prev.y);
  const dNext = Math.hypot(next.x - target.x, next.y - target.y);
  const tension = Math.max(0.22, Math.min(0.85, cornerRoundness)) * 0.42;

  if (tLen < 1e-5) {
    return anchors.map((pt, idx) => (idx === index ? { ...pt, smooth: true } : pt));
  }

  const ux = tx / tLen;
  const uy = ty / tLen;
  const inLen = Math.max(8, Math.min(dPrev * tension, dPrev * 0.45));
  const outLen = Math.max(8, Math.min(dNext * tension, dNext * 0.45));

  return anchors.map((pt, idx) =>
    idx === index
      ? {
          ...pt,
          in_x: round2(pt.x - ux * inLen),
          in_y: round2(pt.y - uy * inLen),
          out_x: round2(pt.x + ux * outLen),
          out_y: round2(pt.y + uy * outLen),
          smooth: true,
        }
      : pt
  );
}

/**
 * If an anchor has completely collapsed handles (in == anchor == out), compute visible
 * directional handles along its neighbor tangent so the operator can immediately grab and drag them.
 */
export function ensureVisibleHandlesForAnchor(
  anchors: BezierAnchor[],
  index: number,
  cornerRoundness = 0.65
): BezierAnchor[] {
  const n = anchors.length;
  if (n < 3 || index < 0 || index >= n) return anchors;
  const pt = anchors[index];
  const inDist = Math.hypot(pt.in_x - pt.x, pt.in_y - pt.y);
  const outDist = Math.hypot(pt.out_x - pt.x, pt.out_y - pt.y);
  if (inDist >= 1.5 || outDist >= 1.5) return anchors;

  const prev = anchors[(index - 1 + n) % n];
  const next = anchors[(index + 1 + n) % n];
  const tx = next.x - prev.x;
  const ty = next.y - prev.y;
  const tLen = Math.hypot(tx, ty);
  if (tLen < 1e-5) return anchors;

  const dPrev = Math.hypot(pt.x - prev.x, pt.y - prev.y);
  const dNext = Math.hypot(next.x - pt.x, next.y - pt.y);
  const tension = Math.max(0.22, Math.min(0.85, cornerRoundness)) * 0.35;
  const ux = tx / tLen;
  const uy = ty / tLen;
  const inLen = Math.max(6, Math.min(dPrev * tension, dPrev * 0.42));
  const outLen = Math.max(6, Math.min(dNext * tension, dNext * 0.42));

  return anchors.map((item, idx) =>
    idx === index
      ? {
          ...item,
          in_x: round2(item.x - ux * inLen),
          in_y: round2(item.y - uy * inLen),
          out_x: round2(item.x + ux * outLen),
          out_y: round2(item.y + uy * outLen),
        }
      : item
  );
}
