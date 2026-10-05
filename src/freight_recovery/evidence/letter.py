"""Draft demand-letter generation (deterministic template, no LLM).

The output is always a DRAFT for human review. It is not legal advice and
contains no auto-send behavior. TODO: per-carrier templates, contract/tariff
citations, dispute-deadline tracking, and optional LLM-assisted tone editing
(behind the same review gate).
"""

from __future__ import annotations

from datetime import date

from freight_recovery.models import ExtractedBundle, Perspective, RecoveryResult

DRAFT_BANNER = "DRAFT - FOR HUMAN REVIEW. NOT SENT. NOT LEGAL ADVICE."


def build_demand_letter(
    bundle: ExtractedBundle, result: RecoveryResult, today: date, window_days: int = 90
) -> str:
    """Render the demand letter for the result's perspective."""
    inv = bundle.invoice
    load = (inv.load_number if inv else None) or "N/A"
    inv_no = (inv.invoice_number if inv else None) or "N/A"
    carrier = (inv.carrier if inv else None) or "Carrier"
    shipper = (inv.shipper if inv else None) or "Shipper"

    if result.perspective is Perspective.SHIPPER:
        to, frm = carrier, shipper
        ask = (
            f"We request a credit or refund of ${result.recoverable_total} against "
            f"invoice {inv_no} (load {load})."
        )
        intro = "Our audit of the above invoice against the signed rate confirmation and " \
            "delivery records found the following billing discrepancies:"
    else:
        to, frm = shipper, carrier
        ask = (
            f"We request payment of ${result.recoverable_total} in accessorial/detention "
            f"charges for load {load} (reference invoice {inv_no})."
        )
        intro = "Delivery records and the signed rate confirmation support the following " \
            "charges that were not billed or were under-billed:"

    lines = [
        DRAFT_BANNER,
        "",
        f"Date: {today.isoformat()}",
        f"To: {to}",
        f"From: {frm}",
        f"Re: Load {load} / Invoice {inv_no} - billing dispute",
        "",
        intro,
        "",
    ]
    for i, f in enumerate(result.findings, 1):
        lines.append(f"{i}. {f.title}: ${f.amount}")
        lines.append(f"   {f.explanation}")
    lines += [
        "",
        ask,
        "Supporting documents and calculations are attached in the evidence packet.",
        f"Please respond within 30 days. (Reminder for sender: confirm the contractual "
        f"dispute window - assumed {window_days} days from invoice date; verify before sending.)",
        "",
        "Sincerely,",
        "[Name / Title / Contact - to be completed by sender]",
    ]
    return "\n".join(lines)
