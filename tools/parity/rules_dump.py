"""Parity oracle: dump the Python reference rules engine + evidence renderers for the given cases.

Usage:  PYTHONPATH=<repo>/src python tools/parity/rules_dump.py < cases.json

Stdin: {"cases": [{"id", "kind": "bundle"|"files"|"classify"|"detention", "bundle"?, "files"?: [{"name",
"b64"}], "docs"?: [{"filename", "doc_type", "sha256"}], "perspective", "settings": {"increment",
"tolerance", "window"}, "now": "YYYY-MM-DDTHH:MM:SS", "descriptions"?, "bol"?, "rc"?}]}

Prints ONE ASCII-safe JSON list, per case:
  bundle/files: {"id", "result", "letter", "markdown", "load_number"}
  classify:     {"id", "classes"}
  detention:    {"id", "detention": null | {"billable_hours", "amount", "steps"}}
or {"id", "error": "<exception class name>"} when the reference raises. Every Decimal is ``str(d)``.

Test oracle only (spec A6): imports nothing but freight_recovery.models, .rules, .evidence, .config,
.ingest and .extraction, builds Settings explicitly (never from the environment) and is never used at
runtime by the API.
"""

from __future__ import annotations

import base64
import json
import sys
from datetime import datetime
from decimal import Decimal

from freight_recovery.config import Settings
from freight_recovery.evidence import build_packet
from freight_recovery.extraction import DeterministicStubProvider, extract_bundle
from freight_recovery.ingest import ingest_bytes
from freight_recovery.models import (
    BillOfLading,
    ChargeLine,
    DocType,
    ExtractedBundle,
    Perspective,
    RateConfirmation,
    RawDocument,
)
from freight_recovery.rules import apply_rules, compute_detention
from freight_recovery.rules.invoice_checks import classify_line


def _finding(f) -> dict[str, object]:
    return {
        "rule_id": f.rule_id,
        "title": f.title,
        "direction": f.direction.value,
        "amount": str(f.amount),
        "explanation": f.explanation,
        "calculation": list(f.calculation),
        "confidence": f.confidence,
        "needs_human_review": f.needs_human_review,
    }


def _result(r) -> dict[str, object]:
    return {
        "perspective": r.perspective.value,
        "findings": [_finding(f) for f in r.findings],
        "recoverable_total": str(r.recoverable_total),
        "pending_review_total": str(r.pending_review_total),
        "ignored_findings": [_finding(f) for f in r.ignored_findings],
    }


def _settings(s: dict[str, object]) -> Settings:
    return Settings(
        detention_increment_minutes=int(s["increment"]),  # type: ignore[arg-type]
        amount_tolerance=Decimal(str(s["tolerance"])),
        dispute_window_days=int(s["window"]),  # type: ignore[arg-type]
    )


def _packet(case: dict, docs: list[RawDocument], bundle: ExtractedBundle) -> dict[str, object]:
    settings = _settings(case["settings"])
    result = apply_rules(bundle, Perspective(case["perspective"]), settings)
    packet = build_packet(
        docs, bundle, result, now=datetime.fromisoformat(case["now"]), window_days=settings.dispute_window_days
    )
    return {
        "result": _result(result),
        "letter": packet.demand_letter,
        "markdown": packet.markdown,
        "load_number": packet.load_number,
    }


def run(case: dict) -> dict[str, object]:
    kind = case["kind"]
    if kind == "classify":
        return {"classes": [classify_line(ChargeLine(description=d, amount=Decimal(0))) for d in case["descriptions"]]}
    if kind == "detention":
        calc = compute_detention(
            BillOfLading.model_validate(case["bol"]),
            RateConfirmation.model_validate(case["rc"]),
            int(case["settings"]["increment"]),
        )
        return {
            "detention": None
            if calc is None
            else {"billable_hours": str(calc.billable_hours), "amount": str(calc.amount), "steps": calc.steps}
        }
    if kind == "bundle":
        bundle = ExtractedBundle.model_validate(case["bundle"])
        docs = [
            RawDocument(filename=d["filename"], doc_type=DocType(d["doc_type"]), text="", sha256=d["sha256"])
            for d in case.get("docs", [])
        ]
        return _packet(case, docs, bundle)
    if kind == "files":
        docs = [ingest_bytes(f["name"], base64.b64decode(f["b64"])) for f in case["files"]]
        bundle = extract_bundle(docs, DeterministicStubProvider())
        return _packet(case, docs, bundle)
    raise ValueError(f"unknown case kind {kind!r}")


def main() -> None:
    cases = json.load(sys.stdin)["cases"]
    out: list[dict[str, object]] = []
    for case in cases:
        entry: dict[str, object] = {"id": case["id"]}
        try:
            entry.update(run(case))
        except Exception as exc:  # noqa: BLE001 - the class name is the observable result
            entry["error"] = type(exc).__name__
        out.append(entry)
    json.dump(out, sys.stdout, ensure_ascii=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
