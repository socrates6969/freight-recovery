"""Deterministic, offline extraction provider.

Parses ``Key: Value`` lines (CSV/PDF text is normalised to this form by ingest).
This is intentionally simple: real carrier documents are messy and will need a
model-based provider (TODO) plus layout-aware parsing. Same input -> same output.

Recognised keys (case-insensitive) are listed in the ``_*_KEYS`` maps below.
Charge lines look like ``Charge: Detention | 300.00``.
"""

from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal, InvalidOperation

from freight_recovery.models import (
    BillOfLading,
    ChargeLine,
    DocType,
    Invoice,
    RateConfirmation,
    RawDocument,
)

from .provider import Extracted

_KV = re.compile(r"^\s*([A-Za-z][A-Za-z0-9 /#_\-]*?)\s*[:=]\s*(.+?)\s*$")
_DT_FORMATS = ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%m/%d/%Y %H:%M")


def _norm(key: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", key.strip().lower()).strip("_")


def parse_money(value: str) -> Decimal | None:
    """Parse ``$1,234.50`` -> ``Decimal('1234.50')``; ``None`` if not numeric."""
    cleaned = value.replace("$", "").replace(",", "").strip()
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def parse_dt(value: str) -> datetime | None:
    """Parse the handful of timestamp formats the stub understands."""
    for fmt in _DT_FORMATS:
        try:
            return datetime.strptime(value.strip(), fmt)
        except ValueError:
            continue
    return None


def _pairs(text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for line in text.splitlines():
        m = _KV.match(line)
        if m:
            out.append((_norm(m.group(1)), m.group(2)))
    return out


class DeterministicStubProvider:
    """Rule-based provider; no network, no randomness."""

    name = "stub"

    def extract(self, doc: RawDocument) -> Extracted | None:
        """Dispatch on ``doc.doc_type``."""
        pairs = _pairs(doc.text)
        if doc.doc_type is DocType.INVOICE:
            return self._invoice(pairs)
        if doc.doc_type is DocType.RATE_CONFIRMATION:
            return self._ratecon(pairs)
        if doc.doc_type is DocType.BOL:
            return self._bol(pairs)
        return None

    @staticmethod
    def _invoice(pairs: list[tuple[str, str]]) -> Invoice:
        inv = Invoice()
        for key, val in pairs:
            if key in ("invoice_number", "invoice", "invoice_no"):
                inv.invoice_number = val
            elif key in ("load_number", "load", "load_no", "pro_number"):
                inv.load_number = val
            elif key == "carrier":
                inv.carrier = val
            elif key == "shipper":
                inv.shipper = val
            elif key == "invoice_date":
                inv.invoice_date = val
            elif key in ("total", "total_due", "amount_due"):
                inv.total = parse_money(val)
            elif key in ("charge", "line"):
                name, _, amt = val.partition("|")
                amount = parse_money(amt)
                if amount is not None and name.strip():
                    inv.lines.append(ChargeLine(description=name.strip(), amount=amount))
        return inv

    @staticmethod
    def _ratecon(pairs: list[tuple[str, str]]) -> RateConfirmation:
        rc = RateConfirmation()
        for key, val in pairs:
            if key in ("load_number", "load", "load_no"):
                rc.load_number = val
            elif key == "carrier":
                rc.carrier = val
            elif key == "linehaul_rate":
                rc.linehaul_rate = parse_money(val)
            elif key in ("fuel_surcharge", "fuel_surcharge_rate"):
                rc.fuel_surcharge = parse_money(val)
            elif key == "detention_free_hours":
                rc.detention_free_hours = parse_money(val)
            elif key == "detention_rate_per_hour":
                rc.detention_rate_per_hour = parse_money(val)
            elif key == "detention_max_hours":
                rc.detention_max_hours = parse_money(val)
            elif key == "authorized_accessorials":
                rc.authorized_accessorials = [v.strip() for v in val.split(",") if v.strip()]
        return rc

    @staticmethod
    def _bol(pairs: list[tuple[str, str]]) -> BillOfLading:
        bol = BillOfLading()
        for key, val in pairs:
            if key in ("load_number", "load", "load_no"):
                bol.load_number = val
            elif key in ("facility", "consignee", "location"):
                bol.facility = val
            elif key in ("appointment_time", "appointment"):
                bol.appointment_time = parse_dt(val)
            elif key in ("arrival_time", "arrival", "check_in"):
                bol.arrival_time = parse_dt(val)
            elif key in ("departure_time", "departure", "check_out"):
                bol.departure_time = parse_dt(val)
        return bol
