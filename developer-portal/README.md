# Developer portal (static, pre-product)

B2B API documentation for the Freight Recovery API, built with **MkDocs 1.6.1 + Material for
MkDocs 9.7.7** (pinned and hash-locked in `requirements.txt`). It documents the real current API
and flags what is planned. It is **built, not deployed**: there is no hosting and no public URL.

## Build locally

```bash
# from the repo root, in a venv (Python 3.11+)
pip install --require-hashes --no-deps -r requirements.txt                    # the API (spec is generated from the real app)
pip install --require-hashes --no-deps -r developer-portal/requirements.txt   # MkDocs + Material

python developer-portal/build.py            # -> developer-portal/site/
python developer-portal/build.py --serve    # preview at http://127.0.0.1:8001
python developer-portal/build.py --check    # CI mode: also fail if openapi.json is stale
```

`build.py` does four things: exports `openapi.json` from the FastAPI app (no server, no key),
renders `docs/api/reference.md` from it, copies the spec next to the Redoc page, and runs
`mkdocs build --strict`.

## What is committed vs generated

- Committed: `docs/*.md`, `mkdocs.yml`, `openapi.json` (a snapshot, so API changes show in review),
  `docs/api/redoc.html`, the lock files.
- Generated and git-ignored: `site/`, `docs/api/reference.md`, `docs/api/openapi.json`.
- If you change the API, run `python developer-portal/build.py` and commit the new `openapi.json`;
  CI (`developer-portal` job) fails otherwise. Update `docs/changelog.md` for visible changes.

## Notes

- `redoc.html` loads Redoc 2.5.4 from jsDelivr with a Subresource Integrity hash (the only
  third-party request at view time). Everything else is self-contained static output.
- Updating dependencies: edit `requirements.in`, then
  `uv pip compile requirements.in --universal --python-version 3.12 --generate-hashes --no-header -o requirements.txt`.
- Material for MkDocs has announced that MkDocs 2.0 will break plugins and themes; this portal is
  deliberately pinned to MkDocs 1.6.1. Revisit before bumping across a major version.

## Deferred

Hosting/deploy (and `site_url`), versioned docs per API release, an official SDK, a try-it console
with real keys, and docs for webhooks, async jobs and rate limiting (none of which exist yet).
