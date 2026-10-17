"""Parity oracle for the ported primitives: sanitize.plain/md and stub.parse_money/parse_dt.

Usage:  PYTHONPATH=<repo>/src python tools/parity/sanitize_dump.py < cases.json

Input (stdin): JSON {"plain": [str...], "md": [str...], "money": [str...], "dt": [str...]}.
Output (stdout, ASCII-safe JSON): the same keys with results (parse_money -> str(Decimal) or null;
parse_dt -> isoformat() or null). Test oracle only; never used at runtime.
"""

from __future__ import annotations

import json
import sys

from freight_recovery.evidence.sanitize import md, plain
from freight_recovery.extraction.stub import parse_dt, parse_money


def main() -> None:
    cases = json.load(sys.stdin)
    money = [parse_money(v) for v in cases.get("money", [])]
    dts = [parse_dt(v) for v in cases.get("dt", [])]
    out = {
        "plain": [plain(v) for v in cases.get("plain", [])],
        "md": [md(v) for v in cases.get("md", [])],
        "money": [None if m is None else str(m) for m in money],
        "dt": [None if d is None else d.isoformat() for d in dts],
    }
    json.dump(out, sys.stdout, ensure_ascii=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
