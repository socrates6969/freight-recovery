"""Forecaster interface for lane-volume / shipment-count time series.

Optional capability, not part of the core recovery flow. A series is an
ordered sequence of non-negative numbers at a fixed cadence (e.g. weekly
shipments on one lane). Multi-series input is a mapping of series id to
sequence (e.g. one entry per lane).
"""

from __future__ import annotations

import math
from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence

DEFAULT_SERIES_KEY = "y"

SeriesInput = Sequence[float] | Mapping[str, Sequence[float]]


class ForecastError(ValueError):
    """Invalid input or unusable series (too short, non-finite, negative...)."""


class ForecasterUnavailableError(RuntimeError):
    """An optional forecaster backend is not installed."""


def normalize_series(data: SeriesInput) -> dict[str, list[float]]:
    """Validate input and return {series_id: [floats]}."""
    if isinstance(data, Mapping):
        items = {str(k): list(v) for k, v in data.items()}
    elif isinstance(data, (str, bytes)):
        raise ForecastError("series must be a sequence of numbers or a mapping")
    else:
        items = {DEFAULT_SERIES_KEY: list(data)}
    if not items:
        raise ForecastError("no series provided")
    out: dict[str, list[float]] = {}
    for key, values in items.items():
        clean: list[float] = []
        for v in values:
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                raise ForecastError(f"series {key!r}: non-numeric value {v!r}")
            f = float(v)
            if not math.isfinite(f):
                raise ForecastError(f"series {key!r}: non-finite value")
            if f < 0:
                raise ForecastError(f"series {key!r}: negative volume")
            clean.append(f)
        out[key] = clean
    return out


class Forecaster(ABC):
    """fit on history, then predict the next `horizon` periods per series."""

    @abstractmethod
    def fit(self, data: SeriesInput) -> Forecaster:
        """Learn from history. Returns self."""

    @abstractmethod
    def predict(self, horizon: int) -> dict[str, list[float]]:
        """Forecast `horizon` future periods for every fitted series."""
