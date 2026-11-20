"""Unit tests for the public order sliding-window rate limiter."""

from app.core.rate_limit import SlidingWindowRateLimiter


def test_rate_limiter_enforces_limit_per_key():
    limiter = SlidingWindowRateLimiter(max_requests=3, window_seconds=60)

    for expected_remaining in (2, 1, 0):
        allowed, remaining, retry_after = limiter.check("127.0.0.1")
        assert allowed is True
        assert remaining == expected_remaining
        assert retry_after == 0

    # 4th request must be blocked
    allowed, remaining, retry_after = limiter.check("127.0.0.1")
    assert allowed is False
    assert remaining == 0
    assert retry_after >= 1

    # Different IP remains unaffected
    allowed_other, remaining_other, _ = limiter.check("10.0.0.2")
    assert allowed_other is True
    assert remaining_other == 2
