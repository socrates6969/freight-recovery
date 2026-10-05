"""Tiny CLI: ``python -m freight_recovery.cli --perspective shipper FILE [FILE...]``."""

from __future__ import annotations

import argparse
from pathlib import Path

from freight_recovery.models import Perspective
from freight_recovery.pipeline import run_pipeline


def main(argv: list[str] | None = None) -> int:
    """Run the pipeline on local files and print the markdown evidence packet."""
    p = argparse.ArgumentParser(description="Freight Recovery MVP (pre-product)")
    p.add_argument("files", nargs="+", type=Path)
    p.add_argument("--perspective", choices=[x.value for x in Perspective], default="shipper")
    args = p.parse_args(argv)
    packet = run_pipeline(
        [(f.name, f.read_bytes()) for f in args.files], Perspective(args.perspective)
    )
    print(packet.markdown)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
