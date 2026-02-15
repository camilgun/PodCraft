"""Memory sampling helpers for lightweight runtime telemetry."""

from __future__ import annotations

import asyncio
import resource
import sys
from contextlib import suppress

BYTES_IN_GIGABYTE = 1024**3

try:
    import psutil  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional dependency
    psutil = None


def _bytes_to_gigabytes(value: int | None) -> float | None:
    """Convert bytes to gigabytes."""
    if value is None:
        return None
    return value / BYTES_IN_GIGABYTE


def _read_ru_maxrss_bytes() -> int | None:
    """Read max RSS from resource usage and normalize to bytes."""
    usage = resource.getrusage(resource.RUSAGE_SELF)
    if usage.ru_maxrss <= 0:
        return None

    if sys.platform == "darwin":
        # macOS already returns bytes.
        return int(usage.ru_maxrss)

    # Linux and most Unix variants report KiB.
    return int(usage.ru_maxrss * 1024)


def _read_process_memory_bytes() -> int | None:
    """Read process RSS in bytes, preferring psutil when available."""
    if psutil is not None:
        try:
            return int(psutil.Process().memory_info().rss)
        except Exception:  # noqa: BLE001
            return None

    return _read_ru_maxrss_bytes()


class MemorySampler:
    """Sample process memory usage with low overhead."""

    def __init__(self, *, sample_interval_seconds: float) -> None:
        if sample_interval_seconds <= 0:
            raise ValueError("sample_interval_seconds must be > 0")
        self.sample_interval_seconds = sample_interval_seconds
        self.baseline_bytes: int | None = None
        self.peak_bytes: int | None = None
        self._stop_event = asyncio.Event()
        self._sampler_task: asyncio.Task[None] | None = None

    async def __aenter__(self) -> MemorySampler:
        self.baseline_bytes = _read_process_memory_bytes()
        self.peak_bytes = self.baseline_bytes
        self._stop_event.clear()
        self._sampler_task = asyncio.create_task(self._sample_loop())
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        self._stop_event.set()
        if self._sampler_task is not None:
            with suppress(asyncio.CancelledError):
                await self._sampler_task
        self._update_peak(_read_process_memory_bytes())

    def _update_peak(self, value: int | None) -> None:
        if value is None:
            return
        if self.peak_bytes is None or value > self.peak_bytes:
            self.peak_bytes = value

    async def _sample_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(), timeout=self.sample_interval_seconds
                )
                break
            except TimeoutError:
                self._update_peak(_read_process_memory_bytes())

    @property
    def peak_memory_gb(self) -> float | None:
        return _bytes_to_gigabytes(self.peak_bytes)

    @property
    def delta_memory_gb(self) -> float | None:
        if self.baseline_bytes is None or self.peak_bytes is None:
            return None
        delta = max(0, self.peak_bytes - self.baseline_bytes)
        return _bytes_to_gigabytes(delta)
