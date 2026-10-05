"""Detention calculation and detention rules.

Industry practice varies; the MVP encodes one explicit, documented convention:

  * Detention clock starts at the LATER of appointment time and arrival time
    (early arrivals do not accrue detention before the appointment).
  * Free time (hours) comes from the rate confirmation.
  * Billable time is rounded DOWN to ``increment_minutes`` (conservative).
  * Billable hours are capped at ``detention_max_hours`` when the rate con sets one.
  * Amount = billable hours x hourly rate.

TODO: facility-specific rules, multi-stop loads, weekend/holiday terms,
carrier-tariff detention, and timezone-aware timestamps.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

from freight_recovery.models import BillOfLading, Direction, Finding, RateConfirmation

CENT = Decimal("0.01")


@dataclass(frozen=True)
class DetentionCalc:
    """Result of the detention computation with an auditable step list."""

    billable_hours: Decimal
    amount: Decimal
    steps: list[str]


def _hours(delta: timedelta) -> Decimal:
    return Decimal(delta.total_seconds()) / Decimal(3600)


def compute_detention(
    bol: BillOfLading, rc: RateConfirmation, increment_minutes: int = 15
) -> DetentionCalc | None:
    """Compute earned detention, or ``None`` if required inputs are missing."""
    if (
        bol.arrival_time is None
        or bol.departure_time is None
        or rc.detention_free_hours is None
        or rc.detention_rate_per_hour is None
    ):
        return None

    start: datetime = bol.arrival_time
    steps: list[str] = []
    if bol.appointment_time is not None and bol.appointment_time > start:
        start = bol.appointment_time
        steps.append(f"Arrived early; clock starts at appointment {start:%Y-%m-%d %H:%M}.")
    else:
        steps.append(f"Clock starts at arrival {start:%Y-%m-%d %H:%M}.")

    dwell = bol.departure_time - start
    dwell_h = _hours(dwell)
    steps.append(f"Departure {bol.departure_time:%Y-%m-%d %H:%M}; dwell = {dwell_h:.2f} h.")
    over = dwell_h - rc.detention_free_hours
    steps.append(f"Less {rc.detention_free_hours} h free time = {max(over, Decimal(0)):.2f} h over.")
    if over <= 0:
        return DetentionCalc(Decimal(0), Decimal("0.00"), steps + ["No detention owed."])

    inc = Decimal(increment_minutes) / Decimal(60)
    billable = (over // inc) * inc  # round down to increment
    steps.append(f"Rounded down to {increment_minutes}-minute increments = {billable:.2f} h.")
    if rc.detention_max_hours is not None and billable > rc.detention_max_hours:
        billable = rc.detention_max_hours
        steps.append(f"Capped at contract max of {billable} h.")
    amount = (billable * rc.detention_rate_per_hour).quantize(CENT)
    steps.append(f"{billable:.2f} h x ${rc.detention_rate_per_hour}/h = ${amount}.")
    return DetentionCalc(billable, amount, steps)


def detention_findings(
    calc: DetentionCalc, invoiced: Decimal, tolerance: Decimal = CENT
) -> list[Finding]:
    """Compare earned detention to what the invoice billed."""
    diff = calc.amount - invoiced
    base = [*calc.steps, f"Invoiced detention = ${invoiced}; earned = ${calc.amount}."]
    if diff > tolerance:
        unbilled = invoiced == 0
        return [
            Finding(
                rule_id="DET-UNBILLED" if unbilled else "DET-UNDERBILLED",
                title="Detention earned but not billed" if unbilled else "Detention under-billed",
                direction=Direction.UNDERBILLED,
                amount=diff.quantize(CENT),
                explanation=f"Gate times and rate-con terms support ${calc.amount} of detention; "
                f"${invoiced} was billed.",
                calculation=base,
                confidence=0.85,
            )
        ]
    if diff < -tolerance:
        return [
            Finding(
                rule_id="DET-OVERBILLED",
                title="Detention billed above supported amount",
                direction=Direction.OVERCHARGE,
                amount=(-diff).quantize(CENT),
                explanation=f"Invoice billed ${invoiced} detention; gate times and rate-con "
                f"terms support only ${calc.amount}.",
                calculation=base,
                confidence=0.85,
            )
        ]
    return []
