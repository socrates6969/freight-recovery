"""Rules / recovery-amount tests."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from freight_recovery.extraction import DeterministicStubProvider, extract_bundle
from freight_recovery.ingest import ingest_bytes
from freight_recovery.models import (
    BillOfLading,
    ChargeLine,
    ExtractedBundle,
    Invoice,
    Perspective,
    RateConfirmation,
)
from freight_recovery.rules import apply_rules, compute_detention

D = Decimal


def _rc(**kw) -> RateConfirmation:
    base = dict(
        detention_free_hours=D("2"), detention_rate_per_hour=D("50"), detention_max_hours=D("8")
    )
    return RateConfirmation(**{**base, **kw})


def _bol(arr: str, dep: str, appt: str | None = None) -> BillOfLading:
    f = lambda s: datetime.strptime(s, "%Y-%m-%d %H:%M")  # noqa: E731
    return BillOfLading(
        arrival_time=f(arr), departure_time=f(dep), appointment_time=f(appt) if appt else None
    )


def _bundle(files):
    docs = [ingest_bytes(n, b) for n, b in files]
    return extract_bundle(docs, DeterministicStubProvider())


# ---- detention math -------------------------------------------------------


def test_detention_early_arrival_starts_at_appointment():
    calc = compute_detention(_bol("2025-03-03 07:45", "2025-03-03 11:30", "2025-03-03 08:00"), _rc())
    assert calc.billable_hours == D("1.5")
    assert calc.amount == D("75.00")


def test_detention_rounds_down_to_15_minutes():
    calc = compute_detention(_bol("2025-03-04 09:00", "2025-03-04 14:20"), _rc())
    assert calc.billable_hours == D("3.25")  # 5h20 - 2h free = 3h20 -> 3h15
    assert calc.amount == D("162.50")


def test_detention_none_within_free_time():
    calc = compute_detention(_bol("2025-03-04 09:00", "2025-03-04 10:30"), _rc())
    assert calc.amount == D("0.00")


def test_detention_capped_at_contract_max():
    calc = compute_detention(_bol("2025-03-04 06:00", "2025-03-04 22:00"), _rc())
    assert calc.billable_hours == D("8")
    assert calc.amount == D("400.00")


def test_detention_missing_inputs_returns_none():
    assert compute_detention(BillOfLading(), _rc()) is None
    assert compute_detention(_bol("2025-03-04 09:00", "2025-03-04 14:00"), RateConfirmation()) is None


# ---- end-to-end scenarios -------------------------------------------------


def test_shipper_scenario_ld5001(ld5001):
    result = apply_rules(_bundle(ld5001), Perspective.SHIPPER)
    by_rule = {f.rule_id: f for f in result.findings}
    assert by_rule["INV-LINEHAUL-RATE"].amount == D("100.00")
    assert by_rule["DET-OVERBILLED"].amount == D("225.00")  # billed 300, supported 75
    assert by_rule["INV-ACCESSORIAL-UNAUTH"].amount == D("150.00")
    assert by_rule["INV-ACCESSORIAL-UNAUTH"].needs_human_review
    # The unauthorised-lumper item needs human review: shown, but NOT in the claimed total.
    assert result.recoverable_total == D("325.00")
    assert result.pending_review_total == D("150.00")
    assert result.ignored_findings == []


def test_carrier_scenario_ld5002_unbilled_detention(ld5002):
    result = apply_rules(_bundle(ld5002), Perspective.CARRIER)
    assert [f.rule_id for f in result.findings] == ["DET-UNBILLED"]
    assert result.recoverable_total == D("162.50")


def test_carrier_perspective_ignores_overcharges(ld5001):
    result = apply_rules(_bundle(ld5001), Perspective.CARRIER)
    assert result.recoverable_total == D("0.00")
    assert len(result.ignored_findings) == 3


def test_underbilled_detention_partial():
    inv = Invoice(lines=[ChargeLine(description="Detention", amount=D("50.00"))])
    b = ExtractedBundle(
        invoice=inv, rate_confirmation=_rc(), bol=_bol("2025-03-04 09:00", "2025-03-04 14:20")
    )
    res = apply_rules(b, Perspective.CARRIER)
    assert res.findings[0].rule_id == "DET-UNDERBILLED"
    assert res.recoverable_total == D("112.50")


def test_duplicate_line_and_total_mismatch():
    inv = Invoice(
        lines=[
            ChargeLine(description="Linehaul", amount=D("1000")),
            ChargeLine(description="Linehaul", amount=D("1000")),
        ],
        total=D("2100"),
    )
    rc = RateConfirmation(linehaul_rate=D("1000"))
    res = apply_rules(ExtractedBundle(invoice=inv, rate_confirmation=rc), Perspective.SHIPPER)
    rules = sorted(f.rule_id for f in res.findings)
    # duplicate removed before rate comparison, so no double counting vs INV-LINEHAUL-RATE
    assert rules == ["INV-DUPLICATE", "INV-TOTAL-MISMATCH"]
    # The repeat could be legitimate (two stops), so it is pending review, not claimed.
    assert res.recoverable_total == D("100.00")
    assert res.pending_review_total == D("1000.00")


def test_clean_invoice_has_no_findings():
    inv = Invoice(
        lines=[ChargeLine(description="Linehaul", amount=D("1400"))], total=D("1400")
    )
    rc = RateConfirmation(linehaul_rate=D("1400"))
    res = apply_rules(ExtractedBundle(invoice=inv, rate_confirmation=rc), Perspective.SHIPPER)
    assert res.findings == [] and res.recoverable_total == D("0.00")


def test_missing_documents_do_not_crash():
    res = apply_rules(ExtractedBundle(), Perspective.SHIPPER)
    assert res.recoverable_total == D("0.00")
