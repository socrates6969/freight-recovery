"""Default dependency-free baseline: seasonal-naive / moving-average.

Forecast for step h is the mean of the observations at the same seasonal
position over the last `n_seasons` seasons. With n_seasons=1 this is plain
seasonal-naive (repeat last season). With season_length=1 it degrades to a
trailing moving average over `n_seasons` points. A flat series forecasts flat.
Deterministic; pure stdlib.
"""

from __future__ import annotations

import math

from .base import ForecastError, Forecaster, SeriesInput, normalize_series


class SeasonalBaselineForecaster(Forecaster):
    def __init__(self, season_length: int = 1, n_seasons: int = 1) -> None:
        if season_length < 1 or n_seasons < 1:
            raise ForecastError("season_length and n_seasons must be >= 1")
        self.season_length = season_length
        self.n_seasons = n_seasons
        self._history: dict[str, list[float]] = {}

    def fit(self, data: SeriesInput) -> SeasonalBaselineForecaster:
        series = normalize_series(data)
        for key, values in series.items():
            if len(values) < self.season_length:
                raise ForecastError(
                    f"series {key!r} has {len(values)} points; "
                    f"need at least season_length={self.season_length}"
                )
        self._history = series
        return self

    def predict(self, horizon: int) -> dict[str, list[float]]:
        if not self._history:
            raise ForecastError("call fit() before predict()")
        if horizon < 1:
            raise ForecastError("horizon must be >= 1")
        return {k: self._forecast_one(v, horizon) for k, v in self._history.items()}

    def _forecast_one(self, values: list[float], horizon: int) -> list[float]:
        m = self.season_length
        n = len(values)
        if m == 1:
            window = values[n - min(self.n_seasons, n):]
            level = math.fsum(window) / len(window)
            return [level] * horizon
        seasons = min(self.n_seasons, n // m)
        out: list[float] = []
        for h in range(1, horizon + 1):
            # same seasonal position in each of the last `seasons` seasons
            pos = n - m + ((h - 1) % m)
            picks = [values[pos - k * m] for k in range(seasons)]
            out.append(math.fsum(picks) / len(picks))
        return out
