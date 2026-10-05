"""Regression + invariant tests for bugs found in the pre-product review.

Each ``test_*`` below reproduces one reviewed defect (see the docstring); the
invariant tests assert properties that must hold for ANY input, not just fixtures.
"""

from __future__ import annotations

import itertools
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from freight_recovery.config import Settings
from freight_recovery.errors import RuleInputError
from freight_recovery.models import (
    BillOfLading,
    ChargeLine,
    Direction,
    ExtractedBundle,
    Invoice,
    Perspective,
    RateConfirmation,
)
from freight_recovery.pipeline import run_pipeline
from freight_recovery.rules import apply_rules, compute_detention
from freight_recovery.rules.invoice_checks import classify_line

D = Decimal
T0 = datetime(2025, 1, 1, 8, 0)


def _rc(**kw) -> RateConfirmation:
    base = dict(detention_free_hours=D(2), detention_rate_per_hour=D(60), detention_max_hours=None)
    return RateConfirmation(**{**base, **kw})


def _bol(minutes_on_site: int, appt: datetime | None = None) -> BillOfLading:
    return BillOfLading(
        arrival_time=T0, departure_time=T0 + timedelta(minutes=minutes_on_site), appointment_time=appt
    )


def _inv(*lines: tuple[str, str], total: str | None = None) -> Invoice:
    return Invoice(
        lines=[ChargeLine(description=d, amount=D(a)) for d, a in lines],
        total=D(total) if total is not None else None,
    )


# ---- F1: detention math in integer minutes -------------------------------


@pytest.mark.parametrize("inc", [1, 5, 6, 7, 10, 12, 15, 20, 30, 45, 60])
def test_exactly_one_increment_over_free_time_is_billed(inc):
    """Was: 20-minute increment + exactly 20 min over -> $0.00 (Decimal rounding)."""
    calc = compute_detention(_bol(120 + inc), _rc(), inc)
    assert calc.amount == D(inc)  # $60/h == $1/min
    assert abs(calc.billable_hours * 60 - inc) < D("1e-20")  # hours is display only


def test_just_under_one_increment_bills_nothing():
    assert compute_detention(_bol(120 + 19), _rc(), 20).amount == D("0.00")


@pytest.mark.parametrize("inc", [6, 7, 10, 15, 20, 25, 30])
def test_detention_amount_never_exceeds_exact_overage(inc):
    """Invariant: billed minutes are a multiple of the increment and <= actual overage."""
    for on_site in range(100, 400, 7):
        calc = compute_detention(_bol(on_site), _rc(), inc)
        over = max(on_site - 120, 0)
        minutes = calc.amount  # $1/min
        assert minutes <= over
        assert minutes % inc == 0
        assert over - minutes < inc  # rounds DOWN by less than one increment


def test_zero_increment_rejected_not_division_by_zero():
    with pytest.raises(ValueError):
        compute_detention(_bol(200), _rc(), 0)
    with pytest.raises(ValueError):
        Settings(detention_increment_minutes=0)


def test_bad_env_increment_is_a_clear_error(monkeypatch):
    monkeypatch.setenv("FR_DETENTION_INCREMENT_MINUTES", "abc")
    with pytest.raises(ValueError, match="integer"):
        Settings.from_env()


def test_detention_max_hours_zero_caps_to_zero():
    assert compute_detention(_bol(400), _rc(detention_max_hours=D(0))).amount == D("0.00")


# ---- F4: naive vs tz-aware timestamps -------------------------------------


def test_mixed_naive_and_aware_timestamps_rejected_cleanly():
    """Was: TypeError (naive - aware) -> HTTP 500."""
    bol = BillOfLading(
        arrival_time=datetime(2025, 1, 1, 8, tzinfo=timezone.utc), departure_time=T0 + timedelta(hours=5)
    )
    with pytest.raises(RuleInputError):
        compute_detention(bol, _rc())


def test_aware_timestamps_in_different_offsets_use_true_elapsed_time():
    est = timezone(timedelta(hours=-5))
    bol = BillOfLading(
        arrival_time=datetime(2025, 1, 1, 8, 0, tzinfo=est),  # 13:00 UTC
        departure_time=datetime(2025, 1, 1, 18, 0, tzinfo=timezone.utc),  # 5h later
    )
    assert compute_detention(bol, _rc()).amount == D("180.00")  # 3h over free time


def test_departure_before_arrival_owes_nothing():
    bol = BillOfLading(arrival_time=T0, departure_time=T0 - timedelta(hours=6))
    assert compute_detention(bol, _rc()).amount == D("0.00")


# ---- F2: duplicate detention lines are not double counted ------------------


def test_duplicate_detention_lines_not_double_counted():
    """Was: 'Detention $60' twice, earned $60 -> INV-DUPLICATE $60 + DET-OVERBILLED $60 = $120."""
    inv = _inv(("Detention", "60"), ("Detention", "60"), total="120")
    b = ExtractedBundle(invoice=inv, rate_confirmation=_rc(), bol=_bol(180))  # earned $60
    res = apply_rules(b, Perspective.SHIPPER)
    assert [f.rule_id for f in res.findings] == ["INV-DUPLICATE"]
    assert res.findings[0].amount == D("60.00")
    # Real overcharge is $60; pending + claimed must never exceed it.
    assert res.recoverable_total + res.pending_review_total <= D("60.00")


# ---- F5: needs-review items are not claimed --------------------------------


def test_needs_review_items_excluded_from_total_and_letter(ld5001):
    packet = run_pipeline(ld5001, Perspective.SHIPPER, now=datetime(2025, 3, 15))
    r = packet.result
    review = [f for f in r.findings if f.needs_human_review]
    assert review, "fixture must contain a needs-review finding"
    assert r.recoverable_total == sum((f.amount for f in r.findings if not f.needs_human_review), D(0))
    assert r.pending_review_total == sum((f.amount for f in review), D(0))
    assert all(f.title not in packet.demand_letter for f in review)
    assert f"${r.recoverable_total}" in packet.demand_letter


def test_letter_with_only_review_items_requests_no_amount():
    inv = _inv(("Lumper", "150"))
    b = ExtractedBundle(invoice=inv, rate_confirmation=RateConfirmation(authorized_accessorials=[]))
    from freight_recovery.evidence import build_demand_letter

    res = apply_rules(b, Perspective.SHIPPER)
    assert res.recoverable_total == D("0.00") and res.pending_review_total == D("150.00")
    letter = build_demand_letter(b, res, datetime(2025, 3, 15).date())
    assert "No amount is requested" in letter
    assert "$150" not in letter and "$0.00" not in letter


# ---- F6: identical legitimate lines need review ----------------------------


def test_two_identical_lines_flagged_for_review_not_claimed():
    """Was: two legitimate 'Lumper $100' (two stops) -> confirmed 0.85 duplicate overcharge."""
    inv = _inv(("Lumper", "100"), ("Lumper", "100"))
    b = ExtractedBundle(invoice=inv, rate_confirmation=RateConfirmation(authorized_accessorials=["lumper"]))
    res = apply_rules(b, Perspective.SHIPPER)
    dup = [f for f in res.findings if f.rule_id == "INV-DUPLICATE"]
    assert len(dup) == 1 and dup[0].needs_human_review and dup[0].confidence < 0.85
    assert res.recoverable_total == D("0.00")


# ---- F7: 'linehaul incl fuel' is not fuel ----------------------------------


def test_linehaul_including_fuel_is_not_a_fuel_overcharge():
    """Was: fuel summed to 1100 vs agreed 100 -> false $1000 INV-FUEL-SURCHARGE."""
    inv = _inv(("Linehaul incl fuel", "1000"), ("Fuel Surcharge", "100"))
    rc = RateConfirmation(linehaul_rate=D(1000), fuel_surcharge=D(100))
    res = apply_rules(ExtractedBundle(invoice=inv, rate_confirmation=rc), Perspective.SHIPPER)
    assert res.findings == []


@pytest.mark.parametrize(
    "desc,expected",
    [
        ("Linehaul incl fuel", "linehaul"),
        ("Linehaul including fuel surcharge", "linehaul"),
        ("Fuel Surcharge", "fuel"),
        ("FSC", "other"),
        ("Linehaul", "linehaul"),
        ("Detention - fuel stop", "detention"),
        ("Stop-off", "accessorial"),
        ("Misc", "other"),
    ],
)
def test_every_line_has_exactly_one_category(desc, expected):
    assert classify_line(ChargeLine(description=desc, amount=D(1))) == expected


# ---- F9: accessorial authorisation matching --------------------------------


def test_hyphen_vs_space_authorisation_matches():
    inv = _inv(("Stop-off", "75"))
    rc = RateConfirmation(authorized_accessorials=["stop off"])
    assert apply_rules(ExtractedBundle(invoice=inv, rate_confirmation=rc), Perspective.SHIPPER).findings == []


def test_blank_authorised_entry_does_not_authorise_everything():
    inv = _inv(("Lumper fee", "100"))
    rc = RateConfirmation(authorized_accessorials=[""])
    res = apply_rules(ExtractedBundle(invoice=inv, rate_confirmation=rc), Perspective.SHIPPER)
    assert [f.rule_id for f in res.findings] == ["INV-ACCESSORIAL-UNAUTH"]


# ---- Invariants over a grid of invoices ------------------------------------

_LINES = [
    [],
    [("Linehaul", "1000")],
    [("Linehaul", "1500"), ("Fuel Surcharge", "300")],
    [("Detention", "60"), ("Detention", "60")],
    [("Detention", "300"), ("Lumper", "150"), ("Lumper", "150")],
    [("Linehaul incl fuel", "1000"), ("Fuel Surcharge", "100"), ("Stop-off", "75")],
]
_TOTALS = [None, "0", "500", "1000", "2500", "99999"]
_BOLS = [None, _bol(100), _bol(180), _bol(900)]


@pytest.mark.parametrize("lines,total,bol", list(itertools.product(_LINES, _TOTALS, _BOLS)))
def test_invariants_recoverable_never_exceeds_billed_and_excludes_review(lines, total, bol):
    inv = _inv(*lines, total=total)
    rc = _rc(linehaul_rate=D(1000), fuel_surcharge=D(100), authorized_accessorials=["detention"])
    res = apply_rules(ExtractedBundle(invoice=inv, rate_confirmation=rc, bol=bol), Perspective.SHIPPER)

    line_sum = sum((ln.amount for ln in inv.lines), D(0))
    ceiling = max(line_sum, inv.total or D(0))
    # Shipper recovery can never exceed what was billed.
    assert res.recoverable_total + res.pending_review_total <= ceiling
    # Needs-review items are never part of the claimed total, and nothing else is missing.
    assert res.recoverable_total == sum(
        (f.amount for f in res.findings if not f.needs_human_review), D(0)
    )
    assert res.pending_review_total == sum(
        (f.amount for f in res.findings if f.needs_human_review), D(0)
    )
    assert all(f.direction is Direction.OVERCHARGE for f in res.findings)
    assert res.recoverable_total >= 0


def test_carrier_total_never_counts_review_items():
    inv = _inv(("Detention", "50"))
    b = ExtractedBundle(invoice=inv, rate_confirmation=_rc(), bol=_bol(260))
    res = apply_rules(b, Perspective.CARRIER)
    assert res.recoverable_total == sum(
        (f.amount for f in res.findings if not f.needs_human_review), D(0)
    )
