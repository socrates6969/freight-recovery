"""Domain models shared across pipeline stages (pydantic v2).

All money values are ``Decimal`` (never float). Datetimes are naive and are
assumed to be in the facility's local time (TODO: timezone handling).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, Field


class DocType(str, Enum):
    """Kinds of documents the pipeline understands."""

    INVOICE = "invoice"
    RATE_CONFIRMATION = "rate_confirmation"
    BOL = "bol"
    UNKNOWN = "unknown"


class Perspective(str, Enum):
    """Whose money are we recovering?

    SHIPPER: recover overcharges the carrier billed us (credits/refunds).
    CARRIER: recover detention/accessorials earned but not billed (or under-billed).
    """

    SHIPPER = "shipper"
    CARRIER = "carrier"


class RawDocument(BaseModel):
    """A document after ingest: bytes decoded to text, type guessed, hash recorded."""

    filename: str
    doc_type: DocType = DocType.UNKNOWN
    text: str
    sha256: str = Field(description="SHA-256 of the original bytes, for evidence integrity.")


class ChargeLine(BaseModel):
    """One line item on a carrier invoice."""

    description: str
    amount: Decimal


class Invoice(BaseModel):
    """Fields extracted from a carrier freight invoice."""

    invoice_number: str | None = None
    load_number: str | None = None
    carrier: str | None = None
    shipper: str | None = None
    invoice_date: str | None = None
    lines: list[ChargeLine] = Field(default_factory=list)
    total: Decimal | None = None


class RateConfirmation(BaseModel):
    """Agreed terms for a load (the contract of record for this MVP)."""

    load_number: str | None = None
    carrier: str | None = None
    linehaul_rate: Decimal | None = None
    fuel_surcharge: Decimal | None = None
    detention_free_hours: Decimal | None = None
    detention_rate_per_hour: Decimal | None = None
    detention_max_hours: Decimal | None = None
    authorized_accessorials: list[str] = Field(default_factory=list)


class BillOfLading(BaseModel):
    """Timestamps/facility evidence from the BOL / gate record."""

    load_number: str | None = None
    facility: str | None = None
    appointment_time: datetime | None = None
    arrival_time: datetime | None = None
    departure_time: datetime | None = None


class ExtractedBundle(BaseModel):
    """All extracted documents for one load. Any member may be missing."""

    invoice: Invoice | None = None
    rate_confirmation: RateConfirmation | None = None
    bol: BillOfLading | None = None
    warnings: list[str] = Field(default_factory=list)


class Direction(str, Enum):
    """OVERCHARGE: carrier billed too much (shipper recovers). UNDERBILLED: carrier is owed."""

    OVERCHARGE = "overcharge"
    UNDERBILLED = "underbilled"


class Finding(BaseModel):
    """One rule hit with the arithmetic that produced it."""

    rule_id: str
    title: str
    direction: Direction
    amount: Decimal = Field(description="Positive dollars attributable to this finding.")
    explanation: str
    calculation: list[str] = Field(default_factory=list, description="Human-readable steps.")
    confidence: float = Field(ge=0, le=1)
    needs_human_review: bool = False


class RecoveryResult(BaseModel):
    """Findings plus the total recoverable for the chosen perspective."""

    perspective: Perspective
    findings: list[Finding]
    recoverable_total: Decimal
    ignored_findings: list[Finding] = Field(
        default_factory=list,
        description="Findings that belong to the other perspective; shown for transparency.",
    )


class EvidencePacket(BaseModel):
    """Everything a human needs to review and send a dispute."""

    load_number: str | None
    perspective: Perspective
    generated_at: datetime
    documents: list[dict[str, str]]
    extracted: ExtractedBundle
    result: RecoveryResult
    demand_letter: str
    markdown: str
    disclaimer: str


class AnalysisResponse(BaseModel):
    """API/CLI output of a full pipeline run."""

    packet: EvidencePacket
