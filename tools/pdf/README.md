# PDF document set: build tool

One command regenerates every figure and PDF in `deliverables/pdf/` from the source documents:

```
py -3.12 -m venv tools/pdf/.venv
tools/pdf/.venv/Scripts/python.exe -m pip install --require-hashes -r tools/pdf/requirements.txt
tools/pdf/.venv/Scripts/python.exe tools/pdf/build.py            # all seven PDFs + MANIFEST.md
tools/pdf/.venv/Scripts/python.exe tools/pdf/build.py 03-financial-package   # one volume, no manifest
```

The build runs offline once the venv exists. It exits non-zero if a number check fails, a table-of-contents
target has no PDF destination, an internal link dangles, the title-page text check fails, or Edge writes no file.

## Pipeline

1. **Figures** (`figures.py`, matplotlib). Every plotted number is read at build time; nothing is typed in.
   - Financial charts read `financial/tools/verify_results.json`, the recomputation of `financial/model.xlsx`
     written by the model's own `financial/tools/verify_model.py` (openpyxl cannot compute the workbook's formulas,
     so the xlsx itself is not read). Each value is then checked against the markdown tables a reader sees in
     `financial/scenarios.md` and `financial/budget.md`.
   - Market chart reads `research/05-market-size.md` § 4; acquisition-cost chart reads
     `marketing/digital/cac-targets.md` § CAC ceilings; the feature-matrix graphic reads
     `research/03-feature-matrix.md` § Matrix and § Columns.
   - Every check (plotted value, source value, tolerance, result) is listed in `deliverables/pdf/MANIFEST.md`.
   - SVGs are deterministic: text drawn as paths, fixed hash salt, no date metadata. `figures/figure-data.json`
     holds every plotted value.
   - Series colours `#0d9488`, `#4f6bd8`, `#d97706` pass the dataviz palette validator (lightness, chroma,
     colour-vision separation, contrast). Brand teal `#0f766e` is used for headings and rules; as a chart fill it
     fails the chroma floor, so charts use the neighbouring teal-600.
2. **Markdown to HTML** (Python-Markdown: tables, fenced code, toc, sane lists). Each volume gets a title page
   (name, 2026-10-18, "Pre-product. Synthetic data only. Not investment advice."), a contents page, and one section
   per source document starting on a new page. Links to repository files are kept as text because they cannot
   resolve inside a PDF. Mermaid blocks in two architecture documents are shown as source text with a note.
3. **HTML to PDF** with Microsoft Edge headless (`--print-to-pdf --no-pdf-header-footer`). Page numbers come from
   CSS `@page` margin boxes. The contents page is rendered with placeholder numbers, the page of every heading is
   read back from the PDF's named destinations (pypdf), and the volume is rendered again until the printed numbers
   match the destinations.

## Choices and why

| Choice | Version | Why |
|---|---|---|
| Python venv, hash-pinned `requirements.txt` (compiled with `uv pip compile --generate-hashes`) | Python 3.12, Markdown 3.11.1, matplotlib 3.11.2, pypdf 6.21.1, fonttools 4.67.0, brotli 1.2.0 | Reproducible, offline after install; no network at build time |
| Microsoft Edge headless | 155.0.4283.62 on the build machine (recorded in MANIFEST at each build) | Already installed on Windows; supports `@page` margin boxes and emits named destinations for internal links |
| Inter Variable, vendored in `fonts/` | @fontsource-variable/inter 5.3.0 (latin, latin-ext, italic subsets), OFL-1.1, licence in `fonts/OFL-LICENSE.txt` | Brand typeface (`web/src/styles/tokens.css`); copied from the repository's own node_modules so the build needs no font download. fontTools instances it to static TTFs for matplotlib. Fallback if a glyph is missing: Segoe UI, Arial |
| No logo | n/a | `marketing/site/static/brand` does not exist in this repository; the brand files live in a separate worktree. The title page uses the lowercase text name only |

## Inputs outside the repository

`07-venture-pipeline` reads three files read-only from `C:\Users\mariu\ventures\` (`_scoring/FINAL.md` and the
two `_builds/*/plan.md`). Their text is copied into the PDF; the files themselves are not committed. MANIFEST records
their SHA-256 so a reader can tell which version was used. The build stops if any of them is missing.

## Determinism

Two builds from a clean state (no `.cache`, no `deliverables/pdf`) produce byte-identical SVGs and
`figure-data.json`, and identical MANIFEST content apart from PDF byte sizes. The PDFs themselves carry Edge's
creation timestamp and are not byte-identical.
