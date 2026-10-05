"""Write the app's real OpenAPI document (no server, no key, no network).

    python developer-portal/scripts/export_openapi.py [--check]

The runtime app serves /openapi.json only behind FR_DOCS_MODE; here we build the same
FastAPI app object in-process with docs "open" and a throwaway SQLite URL and dump
``app.openapi()``. ``--check`` exits 1 if the committed developer-portal/openapi.json is
stale (CI uses this so API changes cannot land without a visible spec diff).
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "openapi.json"
SRC = Path(__file__).resolve().parents[2] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))  # works without PYTHONPATH, from any cwd


def render() -> str:
    tmp = tempfile.mkdtemp(prefix="fr-openapi-")
    os.environ.setdefault("FR_STORAGE_LOCAL_DIR", tmp)  # keep the import side-effect-free
    from freight_recovery.api.main import create_app
    from freight_recovery.config import Settings

    app = create_app(
        Settings(
            environment="dev",
            docs_mode="open",
            sandbox_mode="inprocess",
            database_url=f"sqlite:///{tmp}/openapi.db",
            storage_local_dir=tmp,
        )
    )
    return json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main(argv: list[str]) -> int:
    text = render()
    if "--check" in argv:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current.replace("\r\n", "\n") != text:
            print(f"{OUT} is stale: run `python developer-portal/build.py` and commit it.")
            return 1
        print("openapi.json is up to date")
        return 0
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
