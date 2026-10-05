"""Evidence-packet assembly: documents + extraction + calculations + draft letter."""

from __future__ import annotations

from datetime import datetime

from freight_recovery.models import (
    EvidencePacket,
    ExtractedBundle,
    Perspective,
    RawDocument,
    RecoveryResult,
)

from .letter import build_demand_letter

DISCLAIMER = (
    "MVP / pre-product output. Extracted values and calculations are unverified against "
    "real customer data and must be reviewed by a person before any dispute is sent. "
    "This is not legal or financial advice."
)


def _render_markdown(
    load: str | None,
    perspective: Perspective,
    docs: list[dict[str, str]],
    bundle: ExtractedBundle,
    result: RecoveryResult,
    letter: str,
) -> str:
    out = [
        f"# Evidence Packet - Load {load or 'N/A'}",
        "",
        f"> {DISCLAIMER}",
        "",
        f"**Perspective:** {perspective.value}  ",
        f"**Recoverable (pre-review estimate):** ${result.recoverable_total}",
        "",
        "## Source documents",
    ]
    out += [f"- `{d['filename']}` ({d['doc_type']}) sha256 `{d['sha256']}`" for d in docs]
    if bundle.warnings:
        out += ["", "## Extraction warnings"] + [f"- {w}" for w in bundle.warnings]
    out += ["", "## Findings"]
    if not result.findings:
        out.append("No recoverable findings for this perspective.")
    for i, f in enumerate(result.findings, 1):
        review = " **[needs human review]**" if f.needs_human_review else ""
        out += [
            f"### {i}. {f.title} - ${f.amount}{review}",
            f"Rule `{f.rule_id}`, confidence {f.confidence:.2f}. {f.explanation}",
            "",
            "Calculation:",
        ]
        out += [f"- {s}" for s in f.calculation]
        out.append("")
    if result.ignored_findings:
        out += ["## Other-direction findings (not included in total)"]
        out += [f"- {f.title}: ${f.amount} ({f.direction.value})" for f in result.ignored_findings]
        out.append("")
    out += ["## Draft demand letter", "", "```", letter, "```", ""]
    return "\n".join(out)


def build_packet(
    docs: list[RawDocument],
    bundle: ExtractedBundle,
    result: RecoveryResult,
    now: datetime | None = None,
    window_days: int = 90,
) -> EvidencePacket:
    """Assemble the evidence packet. ``now`` is injectable for deterministic tests."""
    now = now or datetime.now()
    load = next(
        (
            x.load_number
            for x in (bundle.invoice, bundle.rate_confirmation, bundle.bol)
            if x is not None and x.load_number
        ),
        None,
    )
    doc_meta = [
        {"filename": d.filename, "doc_type": d.doc_type.value, "sha256": d.sha256} for d in docs
    ]
    letter = build_demand_letter(bundle, result, now.date(), window_days)
    return EvidencePacket(
        load_number=load,
        perspective=result.perspective,
        generated_at=now,
        documents=doc_meta,
        extracted=bundle,
        result=result,
        demand_letter=letter,
        markdown=_render_markdown(load, result.perspective, doc_meta, bundle, result, letter),
        disclaimer=DISCLAIMER,
    )
