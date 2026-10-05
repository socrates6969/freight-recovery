"""Carrier-invoice error rules (rate, fuel, unauthorized accessorials, duplicates, totals).

Matching is keyword based on the line description. TODO: carrier-specific
charge-code mapping and tariff/contract lookups instead of keywords.
"""

from __future__ import annotations

import re
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


_INCLUDED = re.compile(r"\b(incl|includes|including|included|inc)\b")


def _norm_text(text: str) -> str:
    """Lowercase and collapse punctuation/whitespace so 'Stop-off' == 'stop off'."""
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def classify_line(line: ChargeLine) -> str:
    """Assign a line to exactly ONE category (first match wins; categories never overlap).

    Order matters: detention, then linehaul-that-includes-something ("Linehaul incl fuel"
    is linehaul, not fuel), then fuel surcharge, linehaul, other fuel, accessorial.
    Returns one of ``detention | linehaul | fuel | accessorial | other``.
    """
    d = _norm_text(line.description)
    squashed = d.replace(" ", "")
    if "detention" in d or "dwell" in d:
        return "detention"
    has_linehaul = "linehaul" in squashed
    if has_linehaul and _INCLUDED.search(d):
        return "linehaul"
    if "fuel" in d and ("surcharge" in d or "fsc" in d.split()):
        return "fuel"
    if has_linehaul:
        return "linehaul"
    if "fuel" in d:
        return "fuel"
    if any(_norm_text(w) in d for w in ACCESSORIAL_WORDS):
        return "accessorial"
    return "other"


def is_detention(line: ChargeLine) -> bool:
    """True if the line is a detention/dwell charge."""
    return classify_line(line) == "detention"


def is_linehaul(line: ChargeLine) -> bool:
    """True if the line is base linehaul."""
    return classify_line(line) == "linehaul"


def is_fuel(line: ChargeLine) -> bool:
    """True if the line is a fuel surcharge."""
    return classify_line(line) == "fuel"


def is_accessorial(line: ChargeLine) -> bool:
    """True for known accessorials (detention is handled by its own rule)."""
    return classify_line(line) == "accessorial"


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
                explanation=f"'{ln.description}' for ${ln.amount} appears more than once. "
                "Could be a genuine repeat (e.g. two stops) - verify against the BOL/stop list "
                "before disputing.",
                calculation=[f"Repeat of identical line '{ln.description}' = ${ln.amount}."],
                confidence=0.6,
                needs_human_review=True,
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
        authorized = [n for n in (_norm_text(a) for a in rc.authorized_accessorials) if n]
        for ln in unique:
            if not is_accessorial(ln):
                continue
            d = _norm_text(ln.description)
            if not d or not any(a in d or d in a for a in authorized):
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
