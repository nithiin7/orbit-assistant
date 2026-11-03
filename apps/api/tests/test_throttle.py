from datetime import UTC, datetime, timedelta

from orbit_api.services.local_auth.throttle import (
    MAX_TRACKED_KEYS,
    Limit,
    SignInThrottle,
    SlidingWindow,
)


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 11, 3, 9, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now


def test_a_window_refuses_past_its_limit_until_the_oldest_event_expires() -> None:
    clock = Clock()
    window = SlidingWindow(Limit(3, timedelta(minutes=10)), clock=clock)

    for _ in range(3):
        assert window.retry_after("key") is None
        window.record("key")
        clock.now += timedelta(minutes=1)

    # Events at 9:00, 9:01, 9:02; it is 9:03. The 9:00 event leaves the window at 9:10.
    assert window.retry_after("key") == timedelta(minutes=7)
    clock.now += timedelta(minutes=7)
    assert window.retry_after("key") is None


def test_keys_are_counted_separately_and_can_be_cleared() -> None:
    window = SlidingWindow(Limit(1, timedelta(minutes=1)), clock=Clock())
    window.record("a")

    assert window.retry_after("a") is not None
    assert window.retry_after("b") is None
    window.clear("a")
    assert window.retry_after("a") is None


def test_memory_stays_bounded_under_many_keys() -> None:
    window = SlidingWindow(Limit(1, timedelta(hours=1)), clock=Clock())

    for number in range(MAX_TRACKED_KEYS + 5):
        window.record(f"key {number}")

    assert window.retry_after("key 0") is None  # The oldest keys were forgotten.
    assert window.retry_after(f"key {MAX_TRACKED_KEYS + 4}") is not None


def test_sign_in_waits_for_the_longer_of_the_account_and_client_limits() -> None:
    clock = Clock()
    throttle = SignInThrottle(
        per_account=Limit(2, timedelta(minutes=5)),
        per_client=Limit(3, timedelta(minutes=30)),
        clock=clock,
    )
    throttle.sign_in_failed("ada@example.com", "10.0.0.1")
    throttle.sign_in_failed("ada@example.com", "10.0.0.1")
    throttle.sign_in_failed("grace@example.com", "10.0.0.1")

    assert throttle.sign_in_retry_after("ada@example.com", "10.0.0.2") == timedelta(minutes=5)
    assert throttle.sign_in_retry_after("grace@example.com", "10.0.0.1") == timedelta(minutes=30)
    assert throttle.sign_in_retry_after("grace@example.com", "10.0.0.2") is None
