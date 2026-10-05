"""Build the developer portal (static site) locally or in CI. Does NOT deploy.

    # repo root, venv with the API's requirements AND developer-portal/requirements.txt
    python developer-portal/build.py          # -> developer-portal/site/
    python developer-portal/build.py --serve  # live preview on 127.0.0.1:8001
    python developer-portal/build.py --check  # fail if openapi.json is stale (CI)

Steps: (1) export openapi.json from the FastAPI app (or just verify it with --check),
(2) render the Markdown reference, (3) copy the spec next to the Redoc page,
(4) ``mkdocs build --strict``.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def run(*cmd: str) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=HERE)


def main(argv: list[str]) -> int:
    py = sys.executable
    export = str(HERE / "scripts" / "export_openapi.py")
    run(py, export, *(["--check"] if "--check" in argv else []))
    run(py, str(HERE / "scripts" / "gen_reference.py"))
    shutil.copyfile(HERE / "openapi.json", HERE / "docs" / "api" / "openapi.json")
    if "--serve" in argv:
        run(py, "-m", "mkdocs", "serve", "--strict", "-a", "127.0.0.1:8001")
    else:
        run(py, "-m", "mkdocs", "build", "--strict", "-d", "site")
        print(f"built {HERE / 'site'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
