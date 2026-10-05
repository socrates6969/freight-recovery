"""OPTIONAL neuralforecast-backed forecaster (ROADMAP; not validated).

Requires the `forecast` extra: pip install "freight-recovery[forecast]".
neuralforecast/torch/pandas are imported lazily inside the methods so
importing this module never needs them.
"""

from __future__ import annotations

from .base import (
    ForecastError,
    Forecaster,
    ForecasterUnavailableError,
    SeriesInput,
    normalize_series,
)

INSTALL_HINT = (
    "neuralforecast/torch are not installed. Install the optional extra: "
    'pip install "freight-recovery[forecast]"'
)


class NeuralForecastForecaster(Forecaster):
    """NHITS via neuralforecast. Scaffolding: unvalidated, off by default.

    Needs real multi-series history; on short or sparse lane data it often
    only ties (or loses to) SeasonalBaselineForecaster. Compare before use.
    """

    def __init__(
        self,
        horizon: int,
        freq: str = "W",
        input_size: int | None = None,
        max_steps: int = 200,
    ) -> None:
        try:
            import pandas  # noqa: F401
            from neuralforecast import NeuralForecast  # noqa: F401
            from neuralforecast.models import NHITS  # noqa: F401
        except ImportError as exc:
            raise ForecasterUnavailableError(INSTALL_HINT) from exc
        if horizon < 1:
            raise ForecastError("horizon must be >= 1")
        self.horizon = horizon
        self.freq = freq
        self.input_size = input_size or 2 * horizon
        self.max_steps = max_steps
        self._nf = None
        self._ids: list[str] = []

    def fit(self, data: SeriesInput) -> NeuralForecastForecaster:  # pragma: no cover
        import pandas as pd
        from neuralforecast import NeuralForecast
        from neuralforecast.models import NHITS

        series = normalize_series(data)
        frames = []
        for key, values in series.items():
            ds = pd.date_range("2000-01-01", periods=len(values), freq=self.freq)
            frames.append(pd.DataFrame({"unique_id": key, "ds": ds, "y": values}))
        df = pd.concat(frames, ignore_index=True)
        model = NHITS(
            h=self.horizon,
            input_size=self.input_size,
            max_steps=self.max_steps,
            random_seed=0,
        )
        self._nf = NeuralForecast(models=[model], freq=self.freq)
        self._nf.fit(df=df)
        self._ids = list(series)
        return self

    def predict(self, horizon: int) -> dict[str, list[float]]:  # pragma: no cover
        if self._nf is None:
            raise ForecastError("call fit() before predict()")
        if not 1 <= horizon <= self.horizon:
            raise ForecastError(f"horizon must be in 1..{self.horizon}")
        out = self._nf.predict().reset_index()
        result: dict[str, list[float]] = {}
        for key in self._ids:
            vals = out[out["unique_id"] == key]["NHITS"].tolist()[:horizon]
            result[key] = [max(0.0, float(v)) for v in vals]
        return result
