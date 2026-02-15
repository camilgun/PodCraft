"""Tests for memory sampling utilities."""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

from app.lib.memory import MemorySampler


@pytest.mark.asyncio
async def test_memory_sampler_tracks_peak_and_delta() -> None:
    readings = iter([100, 160, 140, 220])

    def next_reading() -> int:
        return next(readings, 220)

    with patch("app.lib.memory._read_process_memory_bytes", side_effect=next_reading):
        async with MemorySampler(sample_interval_seconds=0.001) as sampler:
            await asyncio.sleep(0.003)

    assert sampler.baseline_bytes == 100
    assert sampler.peak_bytes == 220
    assert sampler.delta_memory_gb is not None
    assert sampler.delta_memory_gb > 0


@pytest.mark.asyncio
async def test_memory_sampler_handles_missing_readings() -> None:
    with patch("app.lib.memory._read_process_memory_bytes", return_value=None):
        async with MemorySampler(sample_interval_seconds=0.001) as sampler:
            await asyncio.sleep(0.002)

    assert sampler.baseline_bytes is None
    assert sampler.peak_bytes is None
    assert sampler.peak_memory_gb is None
    assert sampler.delta_memory_gb is None


def test_memory_sampler_rejects_non_positive_interval() -> None:
    with pytest.raises(ValueError, match="sample_interval_seconds must be > 0"):
        MemorySampler(sample_interval_seconds=0)
