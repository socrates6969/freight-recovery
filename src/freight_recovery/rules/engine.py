"""Rules engine: apply all rules and compute the recovery amount for a perspective."""

from __future__ import annotations

from decimal import Decimal

from freight_recovery.config import Settings
from freight_recovery.models import (
    Direction,
    ExtractedBundle,
    Finding,
    Perspective,
    RecoveryResult,
)

from .detention import compute_detention, detention_findings
from .invoice_checks import dedupe, invoice_findings, is_detention

CENT = Decimal("0.01")


def apply_rules(
    bundle: ExtractedBundle, perspective: Perspective, settings: Settings | None = None
) -> RecoveryResult:
    """Run detention + invoice rules and total the findings for ``perspective``.

    SHIPPER perspective sums OVERCHARGE findings; CARRIER perspective sums
    UNDERBILLED findings. The other direction is reported in ``ignored_findings``.
    Findings flagged ``needs_human_review`` are excluded from ``recoverable_total``
    and summed separately in ``pending_review_total``.
    """
    settings = settings or Settings()
    findings: list[Finding] = []
    inv, rc, bol = bundle.invoice, bundle.rate_confirmation, bundle.bol

    if inv is not None:
        findings += invoice_findings(inv, rc, settings.amount_tolerance)

    if bol is not None and rc is not None:
        calc = compute_detention(bol, rc, settings.detention_increment_minutes)
        if calc is not None:
            # Repeated identical detention lines are reported once by INV-DUPLICATE;
            # count only the de-duplicated lines here so the same dollars are not
            # claimed twice (DET-OVERBILLED + INV-DUPLICATE).
            unique, _ = dedupe(inv.lines) if inv else ([], [])
            invoiced = sum((ln.amount for ln in unique if is_detention(ln)), Decimal(0))
            findings += detention_findings(calc, invoiced, settings.amount_tolerance)

    mine = [
        f
        for f in findings
        if (f.direction is Direction.OVERCHARGE) == (perspective is Perspective.SHIPPER)
    ]
    other = [f for f in findings if f not in mine]
    # Only CONFIRMED findings are claimed; needs_human_review items (confidence < 1,
    # "may be valid") are listed but never counted toward the recoverable total.
    total = sum((f.amount for f in mine if not f.needs_human_review), Decimal(0)).quantize(CENT)
    pending = sum((f.amount for f in mine if f.needs_human_review), Decimal(0)).quantize(CENT)
    return RecoveryResult(
        perspective=perspective,
        findings=mine,
        recoverable_total=total,
        pending_review_total=pending,
        ignored_findings=other,
    )
