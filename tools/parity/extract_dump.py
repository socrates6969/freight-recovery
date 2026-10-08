"""Parity oracle: dump the Python reference ingest + deterministic extraction for the given files.

Usage:  PYTHONPATH=<repo>/src python tools/parity/extract_dump.py FILE [FILE ...]

Prints ONE JSON document (ASCII-safe) to stdout: a list with, per file (named by its basename, which
drives the Python extension dispatch and the filename branch of classify):
  {"file": name,
   "ingest": {"doc_type", "sha256", "warnings", "text"},
   "extracted": null | {"kind": "Invoice"|"RateConfirmation"|"BillOfLading", "data": model_dump(json)},
   "bundle_warnings": [...]}
or {"file": name, "error": "<exception class name>"} when ingest raises.

Test oracle only (A13): imports nothing but freight_recovery.ingest and freight_recovery.extraction and
is never used at runtime by the API.
"""

from __future__ import annotations

import json
import os
import sys

from freight_recovery.extraction import DeterministicStubProvider, extract_bundle
from freight_recovery.ingest import ingest_bytes


def dump(paths: list[str]) -> list[dict[str, object]]:
    provider = DeterministicStubProvider()
    out: list[dict[str, object]] = []
    for path in paths:
        name = os.path.basename(path)
        with open(path, "rb") as fh:
            data = fh.read()
        entry: dict[str, object] = {"file": name}
        try:
            doc = ingest_bytes(name, data)
        except Exception as exc:  # noqa: BLE001 - the class name is the observable result
            entry["error"] = type(exc).__name__
            out.append(entry)
            continue
        entry["ingest"] = {
            "doc_type": doc.doc_type.value,
            "sha256": doc.sha256,
            "warnings": doc.warnings,
            "text": doc.text,
        }
        result = provider.extract(doc)
        entry["extracted"] = (
            None if result is None else {"kind": type(result).__name__, "data": result.model_dump(mode="json")}
        )
        entry["bundle_warnings"] = extract_bundle([doc], provider).warnings
        out.append(entry)
    return out


if __name__ == "__main__":
    json.dump(dump(sys.argv[1:]), sys.stdout, ensure_ascii=True)
    sys.stdout.write("\n")
