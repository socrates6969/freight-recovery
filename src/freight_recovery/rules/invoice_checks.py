"""Carrier-invoice error rules (rate, fuel, unauthorized accessorials, duplicates, totals).

Matching is keyword based on the line description. TODO: carrier-specific
charge-code mapping and tariff/contract lookups instead of keywords.
"""

from __future__ import annotations

from decimal import Decimal

from freight_recovery.models import ChargeLine, Direction, Finding, Invoice, RateConfirmation

CENT = Decimal("0.01")

ACCESSORIAL_WORDS = (
    "lumper",
    "layover",
    "tonu",
    "truck order not used",
    "stop off",
    "stop-off",
    "driver assist",
    "liftgate",
    "reconsign",
    "redeliver",
    "inside delivery",
    "residential",
)


def is_detention(line: ChargeLine) -> bool:
    """True if the line is a detention/dwell charge."""
    d = line.description.lower()
    return "detention" in d or "dwell" in d


def is_linehaul(line: ChargeLine) -> bool:
    """True if the line is base linehaul."""
    d = line.description.lower().replace(" ", "")
    return "linehaul" in d


def is_fuel(line: ChargeLine) -> bool:
    """True if the line is a fuel surcharge."""
    return "fuel" in line.description.lower()


def is_accessorial(line: ChargeLine) -> bool:
    """True for known accessorials (detention is handled by its own rule)."""
    d = line.description.lower()
    return any(w in d for w in ACCESSORIAL_WORDS) and not is_detention(line)


def dedupe(lines: list[ChargeLine]) -> tuple[list[ChargeLine], list[ChargeLine]]:
    """Split lines into (unique, exact-duplicate repeats)."""
    seen: set[tuple[str, Decimal]] = set()
    unique: list[ChargeLine] = []
    dups: list[ChargeLine] = []
    for ln in lines:
        key = (ln.description.strip().lower(), ln.amount)
        (dups if key in seen else unique).append(ln)
        seen.add(key)
    return unique, dups


def _sum(lines: list[ChargeLine]) -> Decimal:
    return sum((ln.amount for ln in lines), Decimal(0))


def invoice_findings(
    inv: Invoice, rc: RateConfirmation | None, tolerance: Decimal = CENT
) -> list[Finding]:
    """Run all invoice-error rules. ``rc`` may be ``None`` (only self-consistency rules run)."""
    findings: list[Finding] = []
    unique, dups = dedupe(inv.lines)

    for ln in dups:
        findings.append(
            Finding(
                rule_id="INV-DUPLICATE",
                title="Duplicate charge line",
                direction=Direction.OVERCHARGE,
                amount=ln.amount.quantize(CENT),
                explanation=f"'{ln.description}' for ${ln.amount} appears more than once.",
                calculation=[f"Repeat of identical line '{ln.description}' = ${ln.amount}."],
                confidence=0.85,
            )
        )

    if rc is not None:
        lh = _sum([ln for ln in unique if is_linehaul(ln)])
        if rc.linehaul_rate is not None and lh - rc.linehaul_rate > tolerance:
            findings.append(
                Finding(
                    rule_id="INV-LINEHAUL-RATE",
                    title="Linehaul billed above rate confirmation",
                    direction=Direction.OVERCHARGE,
                    amount=(lh - rc.linehaul_rate).quantize(CENT),
                    explanation=f"Invoice linehaul ${lh} vs agreed ${rc.linehaul_rate}.",
                    calculation=[f"${lh} - ${rc.linehaul_rate} = ${(lh - rc.linehaul_rate)}."],
                    confidence=0.95,
                )
            )
        fsc = _sum([ln for ln in unique if is_fuel(ln)])
        if rc.fuel_surcharge is not None and fsc - rc.fuel_surcharge > tolerance:
            findings.append(
                Finding(
                    rule_id="INV-FUEL-SURCHARGE",
                    title="Fuel surcharge above rate confirmation",
                    direction=Direction.OVERCHARGE,
                    amount=(fsc - rc.fuel_surcharge).quantize(CENT),
                    explanation=f"Invoice fuel ${fsc} vs agreed ${rc.fuel_surcharge}.",
                    calculation=[f"${fsc} - ${rc.fuel_surcharge} = ${(fsc - rc.fuel_surcharge)}."],
                    confidence=0.9,
                )
            )
        authorized = [a.lower() for a in rc.authorized_accessorials]
        for ln in unique:
            if not is_accessorial(ln):
                continue
            d = ln.description.lower()
            if not any(a in d or d in a for a in authorized):
                findings.append(
                    Finding(
                        rule_id="INV-ACCESSORIAL-UNAUTH",
                        title="Accessorial not authorized on rate confirmation",
                        direction=Direction.OVERCHARGE,
                        amount=ln.amount.quantize(CENT),
                        explanation=f"'{ln.description}' (${ln.amount}) is not listed as "
                        "authorized on the rate confirmation. May be valid with a receipt or "
                        "separate approval - verify before disputing.",
                        calculation=[
                            f"Authorized accessorials: {rc.authorized_accessorials or 'none'}.",
                            f"Charged: '{ln.description}' = ${ln.amount}.",
                        ],
                        confidence=0.6,
                        needs_human_review=True,
                    )
                )

    if inv.total is not None and inv.lines:
        line_sum = _sum(inv.lines)
        if inv.total - line_sum > tolerance:
            findings.append(
                Finding(
                    rule_id="INV-TOTAL-MISMATCH",
                    title="Invoice total exceeds sum of line items",
                    direction=Direction.OVERCHARGE,
                    amount=(inv.total - line_sum).quantize(CENT),
                    explanation=f"Stated total ${inv.total} vs line items ${line_sum}.",
                    calculation=[f"${inv.total} - ${line_sum} = ${(inv.total - line_sum)}."],
                    confidence=0.9,
                )
            )
    return findings
