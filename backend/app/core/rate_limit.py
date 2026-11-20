"""Thread-safe sliding-window rate limiter for public anti-spam protection."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import HTTPException, Request, Response, status

from app.core.config import get_settings


class SlidingWindowRateLimiter:
    """
    In-memory sliding-window rate limiter.
    Designed cleanly so a Redis backend can replace `_hits` in multi-worker clusters.
    """

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> tuple[bool, int, int]:
        """
        Register a hit for `key`.
        Returns (allowed, remaining_requests, retry_after_seconds).
        """
        now = time.monotonic()
        cutoff = now - self.window_seconds

        with self._lock:
            bucket = self._hits[key]
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()

            if len(bucket) >= self.max_requests:
                oldest = bucket[0]
                retry_after = max(1, int(self.window_seconds - (now - oldest)) + 1)
                return False, 0, retry_after

            bucket.append(now)
            remaining = max(0, self.max_requests - len(bucket))
            return True, remaining, 0

    def reset(self) -> None:
        """Clear all rate-limit buckets (useful in automated tests)."""
        with self._lock:
            self._hits.clear()


def _extract_client_ip(request: Request, trust_proxy: bool) -> str:
    if trust_proxy:
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            first_ip = forwarded_for.split(",")[0].strip()
            if first_ip:
                return first_ip
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


_settings = get_settings()
public_orders_limiter = SlidingWindowRateLimiter(
    max_requests=_settings.RATE_LIMIT_PUBLIC_ORDERS_REQUESTS,
    window_seconds=_settings.RATE_LIMIT_PUBLIC_ORDERS_WINDOW_SECONDS,
)


async def enforce_public_order_rate_limit(request: Request, response: Response) -> None:
    """FastAPI dependency enforcing rate limit on public order submissions."""
    settings = get_settings()
    client_ip = _extract_client_ip(request, trust_proxy=settings.TRUST_PROXY_HEADERS)
    allowed, remaining, retry_after = public_orders_limiter.check(client_ip)

    response.headers["X-RateLimit-Limit"] = str(public_orders_limiter.max_requests)
    response.headers["X-RateLimit-Remaining"] = str(remaining)

    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Has superado el límite temporal de envíos de pedidos. "
                f"Por favor espera {retry_after} segundos e inténtalo de nuevo."
            ),
            headers={"Retry-After": str(retry_after)},
        )
