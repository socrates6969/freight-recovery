import importlib.util

import pytest

from freight_recovery.forecast import (
    ForecastError,
    ForecasterUnavailableError,
    NeuralForecastForecaster,
    SeasonalBaselineForecaster,
)

WEEK = [10, 20, 30, 40, 50, 60, 70]


def test_seasonal_naive_repeats_last_season():
    f = SeasonalBaselineForecaster(season_length=7).fit(WEEK * 3)
    assert f.predict(7)["y"] == [float(x) for x in WEEK]


def test_horizon_longer_than_season_wraps():
    out = SeasonalBaselineForecaster(season_length=7).fit(WEEK * 2).predict(10)["y"]
    assert len(out) == 10
    assert out[7:] == [10.0, 20.0, 30.0]


def test_deterministic():
    data = {"a": WEEK * 2, "b": [1, 2, 3, 4] * 4}
    a = SeasonalBaselineForecaster(season_length=4).fit(data).predict(5)
    b = SeasonalBaselineForecaster(season_length=4).fit(data).predict(5)
    assert a == b


def test_multi_series_independent():
    out = SeasonalBaselineForecaster(season_length=2).fit(
        {"lane1": [1, 9, 1, 9], "lane2": [5, 5, 5, 5]}
    ).predict(2)
    assert out == {"lane1": [1.0, 9.0], "lane2": [5.0, 5.0]}


def test_seasonal_average_over_n_seasons():
    f = SeasonalBaselineForecaster(season_length=2, n_seasons=2).fit([2, 4, 4, 8])
    assert f.predict(2)["y"] == [3.0, 6.0]


def test_moving_average_when_no_seasonality():
    f = SeasonalBaselineForecaster(season_length=1, n_seasons=3).fit([1, 2, 9, 4, 5])
    assert f.predict(2)["y"] == [6.0, 6.0]


def test_flat_series_stays_flat():
    for m in (1, 7):
        out = SeasonalBaselineForecaster(season_length=m).fit([4] * 14).predict(3)
        assert out["y"] == [4.0] * 3


def test_all_zero_series():
    out = SeasonalBaselineForecaster(season_length=3).fit([0] * 6).predict(2)
    assert out["y"] == [0.0, 0.0]


def test_too_short_series_rejected():
    with pytest.raises(ForecastError):
        SeasonalBaselineForecaster(season_length=7).fit([1, 2, 3])
    with pytest.raises(ForecastError):
        SeasonalBaselineForecaster().fit([])


@pytest.mark.parametrize(
    "bad", [[1, -2, 3], [1, float("nan")], [1, float("inf")], [1, "x"], [True]]
)
def test_bad_values_rejected(bad):
    with pytest.raises(ForecastError):
        SeasonalBaselineForecaster().fit(bad)


def test_predict_before_fit_and_bad_horizon():
    f = SeasonalBaselineForecaster()
    with pytest.raises(ForecastError):
        f.predict(1)
    f.fit([1, 2])
    with pytest.raises(ForecastError):
        f.predict(0)


def test_bad_params():
    with pytest.raises(ForecastError):
        SeasonalBaselineForecaster(season_length=0)


def test_no_series():
    with pytest.raises(ForecastError):
        SeasonalBaselineForecaster().fit({})


@pytest.mark.skipif(
    importlib.util.find_spec("neuralforecast") is not None,
    reason="forecast extra installed",
)
def test_neural_without_extra_raises_clear_error():
    with pytest.raises(ForecasterUnavailableError, match=r"\[forecast\]"):
        NeuralForecastForecaster(horizon=4)


def test_neural_smoke_when_extra_installed():
    pytest.importorskip("neuralforecast")
    pytest.importorskip("torch")
    f = NeuralForecastForecaster(horizon=2, freq="D", input_size=4, max_steps=5)
    out = f.fit({"a": [float(i % 7 + 1) for i in range(40)]}).predict(2)
    assert len(out["a"]) == 2
