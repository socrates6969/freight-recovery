# Developer portal

B2B API documentation for the scoup.ai workspace API, built with **MkDocs 1.6.1 + Material for
MkDocs 9.7.7** (pinned and hash-locked in `requirements.txt`). It documents the real current API
and flags what is planned. The hosted workspace API is a **prototype that is not offered to
customers yet**; keys are issued only to early-access teams, and the portal says so on its landing
and authentication pages.

## Where it is published

Under `/docs/` of the marketing site (https://socrates6969.github.io/freight-recovery/docs/):
`.github/workflows/pages.yml` builds this portal with `build.py --check`, and `marketing/site/build.mjs`
copies `site/` to `dist/docs/` when `SITE_DOCS_DIR` points at it. `mkdocs.yml` sets `site_url` to that
address (it feeds only the canonical link and the sitemap; page and asset links stay relative). The
site's rules apply here too: `marketing/site/test.mjs` fails the deploy if any HTML or CSS under
`dist/docs` loads or links anything from the network, so the theme runs with `font: false` (no Google
Fonts), `extra.generator: false` (no footer link) and no analytics or CDN scripts.

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
renders `docs/api/reference.md` from it, copies the spec into `docs/api/`, and runs
`mkdocs build --strict`.

## What is committed vs generated

- Committed: `docs/*.md`, `mkdocs.yml`, `openapi.json` (a snapshot, so API changes show in review),
  the lock files.
- Generated and git-ignored: `site/`, `docs/api/reference.md`, `docs/api/openapi.json`.
- If you change the API, run `python developer-portal/build.py` and commit the new `openapi.json`;
  CI (`developer-portal` job) fails otherwise. Update `docs/changelog.md` for visible changes.

## Notes

- Everything in `site/` is self-contained static output; nothing is fetched at view time. The
  earlier interactive Redoc page was dropped for that reason (it loaded Redoc from a CDN); the
  Markdown reference is generated from the same spec and the raw `openapi.json` is served next to it.
- Updating dependencies: edit `requirements.in`, then
  `uv pip compile requirements.in --universal --python-version 3.12 --generate-hashes --no-header -o requirements.txt`.
- Material for MkDocs has announced that MkDocs 2.0 will break plugins and themes; this portal is
  deliberately pinned to MkDocs 1.6.1. Revisit before bumping across a major version.

## Deferred

Versioned docs per API release, an official SDK, a try-it console with real keys, and docs for
webhooks, async jobs and rate limiting (none of which exist yet).
