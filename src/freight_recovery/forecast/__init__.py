"""Optional demand / lane-volume forecasting (roadmap capability).

The baseline needs no extra dependencies. The neural backend is opt-in via
the `forecast` extra and is imported lazily (see neural.py).
"""

from .base import (
    DEFAULT_SERIES_KEY,
    ForecastError,
    Forecaster,
    ForecasterUnavailableError,
)
from .baseline import SeasonalBaselineForecaster
from .neural import NeuralForecastForecaster  # safe: heavy imports are lazy

__all__ = [
    "DEFAULT_SERIES_KEY",
    "ForecastError",
    "Forecaster",
    "ForecasterUnavailableError",
    "NeuralForecastForecaster",
    "SeasonalBaselineForecaster",
]
