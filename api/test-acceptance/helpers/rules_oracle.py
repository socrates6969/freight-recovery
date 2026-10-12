# Test-owned rules/evidence parity oracle (REQ-20261010-step5-analysis, test-spec T4).
# Uses only the public modules freight_recovery.models, .rules, .evidence, .config, .ingest, .extraction.
# Settings are always explicit (never read from the environment).
# Input: path to a JSON array of cases; output: JSON array of results in the same order.
import base64
import json
import sys
from datetime import date, datetime
from decimal import Decimal

from freight_recovery.config import Settings
from freight_recovery.evidence import build_packet
from freight_recovery.evidence.letter import build_demand_letter
from freight_recovery.extraction import extract_bundle, get_provider
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
from freight_recovery.rules import apply_rules
from freight_recovery.rules.detention import compute_detention
from freight_recovery.rules.invoice_checks import classify_line


def settings_of(s):
    s = s or {}
    return Settings(
        detention_increment_minutes=int(s.get("detentionIncrementMinutes", 15)),
        amount_tolerance=Decimal(s.get("amountTolerance", "0.01")),
        dispute_window_days=int(s.get("disputeWindowDays", 90)),
    )


def finding(f):
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


def result(r):
    return {
        "perspective": r.perspective.value,
        "findings": [finding(f) for f in r.findings],
        "recoverable_total": str(r.recoverable_total),
        "pending_review_total": str(r.pending_review_total),
        "ignored_findings": [finding(f) for f in r.ignored_findings],
    }


def run(case):
    op = case["op"]
    if op == "classify":
        return {"category": classify_line(ChargeLine(description=case["description"], amount=Decimal(0)))}
    if op == "detention":
        bol = BillOfLading.model_validate(case["bol"])
        rc = RateConfirmation.model_validate(case["rc"])
        calc = compute_detention(bol, rc, int(case.get("inc", 15)))
        if calc is None:
            return {"calc": None}
        return {"calc": {"billable_hours": str(calc.billable_hours), "amount": str(calc.amount), "steps": list(calc.steps)}}
    if op in ("rules", "letter", "markdown"):
        bundle = ExtractedBundle.model_validate(case["bundle"])
        st = settings_of(case.get("settings"))
        res = apply_rules(bundle, Perspective(case["perspective"]), st)
        out = {"result": result(res)}
        if op == "letter":
            out["letter"] = build_demand_letter(bundle, res, date.fromisoformat(case["today"]), st.dispute_window_days)
        if op == "markdown":
            docs = [
                RawDocument(filename=d["filename"], doc_type=DocType(d["doc_type"]), text="", sha256=d["sha256"])
                for d in case["docs"]
            ]
            now = datetime.fromisoformat(case["now"])
            p = build_packet(docs, bundle, res, now=now, window_days=st.dispute_window_days)
            out["letter"] = p.demand_letter
            out["markdown"] = p.markdown
            out["load_number"] = p.load_number
        return out
    if op == "pipeline":
        st = settings_of(case.get("settings"))
        prov = get_provider("stub")
        docs = [ingest_bytes(f["name"], base64.b64decode(f["b64"])) for f in case["files"]]
        bundle = extract_bundle(docs, prov)
        res = apply_rules(bundle, Perspective(case["perspective"]), st)
        now = datetime.fromisoformat(case["now"])
        p = build_packet(docs, bundle, res, now=now, window_days=st.dispute_window_days)
        return {"result": result(res), "letter": p.demand_letter, "markdown": p.markdown, "load_number": p.load_number}
    raise ValueError("unknown op " + op)


def main():
    cases = json.load(open(sys.argv[1], encoding="utf-8"))
    out = []
    for c in cases:
        try:
            out.append(run(c))
        except Exception as e:  # reported, compared by the caller
            out.append({"error": type(e).__name__, "message": str(e)[:200]})
    sys.stdout.write(json.dumps(out, ensure_ascii=True))


if __name__ == "__main__":
    main()
