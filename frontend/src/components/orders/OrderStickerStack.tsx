import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Layers } from "lucide-react";
import { ordersService } from "@/services/orders.service";
import type { OrderItem, StickerShape } from "@/types/order";

interface StackSlot {
  cacheKey: string;
  orderId: string;
  itemId?: string;
  label: string;
  shape: StickerShape;
  variant?: "original" | "enhanced";
}

const MAX_CACHED_THUMBNAILS = 180;
const thumbnailCache = new Map<string, string>();
const inFlightRequests = new Map<string, Promise<string | null>>();

function getCachedThumbnail(cacheKey: string): string | undefined {
  const hit = thumbnailCache.get(cacheKey);
  if (hit) {
    // Refresh LRU order
    thumbnailCache.delete(cacheKey);
    thumbnailCache.set(cacheKey, hit);
  }
  return hit;
}

function setCachedThumbnail(cacheKey: string, url: string): void {
  if (thumbnailCache.has(cacheKey)) {
    thumbnailCache.delete(cacheKey);
  }
  thumbnailCache.set(cacheKey, url);
  while (thumbnailCache.size > MAX_CACHED_THUMBNAILS) {
    const oldestKey = thumbnailCache.keys().next().value;
    if (!oldestKey) break;
    const oldestUrl = thumbnailCache.get(oldestKey);
    thumbnailCache.delete(oldestKey);
    if (oldestUrl) URL.revokeObjectURL(oldestUrl);
  }
}

async function loadThumbnail(slot: StackSlot): Promise<string | null> {
  const cached = getCachedThumbnail(slot.cacheKey);
  if (cached) return cached;

  const existingPromise = inFlightRequests.get(slot.cacheKey);
  if (existingPromise) return existingPromise;

  const promise = (async () => {
    try {
      const url = slot.itemId
        ? await ordersService.fetchOrderItemImageObjectUrl(
            slot.orderId,
            slot.itemId,
            slot.variant
          )
        : await ordersService.fetchOrderImageObjectUrl(slot.orderId, slot.variant);
      setCachedThumbnail(slot.cacheKey, url);
      return url;
    } catch {
      return null;
    } finally {
      inFlightRequests.delete(slot.cacheKey);
    }
  })();

  inFlightRequests.set(slot.cacheKey, promise);
  return promise;
}

interface OrderStickerStackProps {
  order: OrderItem;
  size?: "sm" | "md";
  /** Render the `+N diseños` pill badge right alongside the fanned stack when count >= 2. */
  showBadge?: boolean;
  className?: string;
}

/**
 * "Pila de Stickers" (Sticker Stack):
 * - Single-design order: crisp white-bordered die-cut sticker thumbnail.
 * - Multi-design order (2+): up to 3 gently fanned (`rotate`) thumbnails with pure white
 *   vinyl sticker border and a `+N diseños` die-cut badge; smoothly fans open on hover.
 */
export const OrderStickerStack: React.FC<OrderStickerStackProps> = ({
  order,
  size = "sm",
  showBadge = true,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  const totalCount = Math.max(1, order.items_count ?? order.items?.length ?? 1);
  const isMulti = totalCount >= 2;
  const extraCount = Math.max(0, totalCount - 1);

  const slots = useMemo<StackSlot[]>(() => {
    if (order.items && order.items.length > 0) {
      return order.items.slice(0, 3).map((item) => ({
        cacheKey: `${order.id}:item:${item.id}:${item.image.safe_filename}`,
        orderId: order.id,
        itemId: item.id,
        label: `Diseño #${item.position}`,
        shape: item.shape,
      }));
    }
    return [
      {
        cacheKey: `${order.id}:primary:${order.image?.safe_filename ?? "img"}`,
        orderId: order.id,
        label: order.order_number,
        shape: order.shape,
      },
    ];
  }, [order.id, order.items, order.image?.safe_filename, order.order_number, order.shape]);

  const [urls, setUrls] = useState<Record<string, string | null>>(() => {
    const initial: Record<string, string | null> = {};
    for (const slot of slots) {
      const hit = getCachedThumbnail(slot.cacheKey);
      if (hit) initial[slot.cacheKey] = hit;
    }
    return initial;
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || inView) return;

    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView]);

  useEffect(() => {
    if (!inView) return;
    let cancelled = false;

    const missing = slots.filter((slot) => urls[slot.cacheKey] === undefined);
    if (missing.length === 0) return;

    void Promise.all(
      missing.map(async (slot) => {
        const resolved = await loadThumbnail(slot);
        return [slot.cacheKey, resolved] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      setUrls((prev) => {
        const next = { ...prev };
        for (const [k, v] of entries) {
          next[k] = v;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [inView, slots, urls]);

  const dimClass = size === "md" ? "h-12 w-12" : "h-10 w-10";
  const stageClass =
    size === "md"
      ? isMulti
        ? "h-14 w-[4.5rem]"
        : "h-12 w-12"
      : isMulti
      ? "h-12 w-[3.75rem]"
      : "h-10 w-10";

  // Render back-to-front so index 0 sits cleanly on top
  const orderedSlots = useMemo(() => {
    return slots
      .map((slot, index) => ({ slot, index }))
      .reverse();
  }, [slots]);

  const getLayerMotionClass = (index: number, count: number): string => {
    if (count === 1) {
      return "z-10 rotate-0 group-hover:-rotate-2 group-hover:scale-105 group-hover/stack:-rotate-2 group-hover/stack:scale-105";
    }
    if (count === 2) {
      if (index === 0) {
        return "z-20 -rotate-[4deg] -translate-x-1 group-hover:-rotate-[10deg] group-hover:-translate-x-3 group-hover:-translate-y-0.5 group-hover:scale-105 group-hover/stack:-rotate-[10deg] group-hover/stack:-translate-x-3 group-hover/stack:-translate-y-0.5 group-hover/stack:scale-105";
      }
      return "z-10 rotate-[9deg] translate-x-1.5 translate-y-0.5 scale-[0.94] group-hover:rotate-[16deg] group-hover:translate-x-3.5 group-hover:-translate-y-0.5 group-hover:scale-[0.98] group-hover/stack:rotate-[16deg] group-hover/stack:translate-x-3.5 group-hover/stack:-translate-y-0.5 group-hover/stack:scale-[0.98]";
    }
    // 3-card fan
    if (index === 0) {
      return "z-20 -rotate-[2deg] group-hover:rotate-0 group-hover:-translate-y-1 group-hover:scale-105 group-hover/stack:rotate-0 group-hover/stack:-translate-y-1 group-hover/stack:scale-105";
    }
    if (index === 1) {
      return "z-10 rotate-[9deg] translate-x-1.5 translate-y-0.5 scale-[0.94] group-hover:rotate-[17deg] group-hover:translate-x-4 group-hover:-translate-y-0.5 group-hover:scale-[0.98] group-hover/stack:rotate-[17deg] group-hover/stack:translate-x-4 group-hover/stack:-translate-y-0.5 group-hover/stack:scale-[0.98]";
    }
    return "z-0 -rotate-[11deg] -translate-x-1.5 translate-y-0.5 scale-[0.9] group-hover:-rotate-[18deg] group-hover:-translate-x-4 group-hover:-translate-y-0.5 group-hover:scale-[0.96] group-hover/stack:-rotate-[18deg] group-hover/stack:-translate-x-4 group-hover/stack:-translate-y-0.5 group-hover/stack:scale-[0.96]";
  };

  return (
    <div
      ref={containerRef}
      className={`group/stack inline-flex shrink-0 items-center gap-2 ${className}`}
      title={
        isMulti
          ? `${totalCount} diseños en este pedido (${slots.map((s) => s.label).join(", ")})`
          : order.image?.original_filename || order.order_number
      }
    >
      <div className={`relative flex shrink-0 items-center justify-center ${stageClass}`}>
        {orderedSlots.map(({ slot, index }) => {
          const thumbUrl = urls[slot.cacheKey];
          const isLoading = inView && thumbUrl === undefined;
          const shapeRadius = slot.shape === "Circular" ? "rounded-full" : "rounded-md";
          const motionClass = getLayerMotionClass(index, slots.length);

          return (
            <div
              key={slot.cacheKey}
              className={`absolute left-1/2 top-1/2 -ml-[calc(var(--thumb-size)/2)] -mt-[calc(var(--thumb-size)/2)] flex items-center justify-center overflow-hidden border-2 border-sborg-white bg-surface-card shadow-sticker ring-1 ring-line-subtle/60 transition-transform duration-base ease-studio will-change-transform motion-reduce:transition-none motion-reduce:transform-none ${dimClass} ${shapeRadius} ${motionClass}`}
              style={
                {
                  "--thumb-size": size === "md" ? "3rem" : "2.5rem",
                } as React.CSSProperties
              }
            >
              <div className="bg-transparency-grid flex h-full w-full items-center justify-center p-0.5">
                {thumbUrl ? (
                  <img
                    src={thumbUrl}
                    alt={slot.label}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-contain"
                  />
                ) : isLoading ? (
                  <div className="h-full w-full animate-pulse rounded-xs bg-surface-elevated/90" />
                ) : (
                  <ImageIcon
                    className="h-3.5 w-3.5 text-ink-muted/70"
                    aria-hidden="true"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showBadge && isMulti && (
        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-line-diecut/80 bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums text-accent shadow-xs transition-colors duration-fast ease-studio group-hover:border-line-diecut group-hover:bg-accent group-hover:text-accent-ink">
          <Layers className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
          +{extraCount} {extraCount === 1 ? "diseño" : "diseños"}
        </span>
      )}
    </div>
  );
};
