"""Build the scoup.ai PDF document set from source.

Run from the repository root:
    tools/pdf/.venv/Scripts/python.exe tools/pdf/build.py

Regenerates deliverables/pdf/figures/*.svg (from source data, see figures.py), renders each
volume Markdown -> HTML (print stylesheet, Inter) -> PDF with Microsoft Edge headless, fills the
table of contents with page numbers read back from the PDF's named destinations, and writes
deliverables/pdf/MANIFEST.md. Exits non-zero if any number check, TOC check or render fails.
"""
import hashlib, html, json, os, re, shutil, subprocess, sys
from pathlib import Path

import markdown
from pypdf import PdfReader

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import figures as F  # noqa: E402

OUT = ROOT / "deliverables" / "pdf"
FIGDIR = OUT / "figures"
CACHE = HERE / ".cache"
EDGE = Path(os.environ.get("PDF_EDGE", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"))
DATE = "2026-10-18"
DISCLAIMER = "Pre-product. Synthetic data only. Not investment advice."
VENTURES = Path(r"C:\Users\mariu\ventures")
EXTERNAL = {  # read-only venture work outside the repo; text is copied into the PDF, files are not committed
    "_scoring/FINAL.md": VENTURES / "_scoring" / "FINAL.md",
    "_builds/commission-reconciliation/plan.md": VENTURES / "_builds" / "commission-reconciliation" / "plan.md",
    "_builds/premium-audit-defense/plan.md": VENTURES / "_builds" / "premium-audit-defense" / "plan.md",
}

ADRS = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "docs" / "adr").glob("0*.md"))
VOLUMES = [
    ("01-business-plan", "scoup.ai business plan", ["business/business-plan.md"]),
    ("02-founder-narrative", "scoup.ai founder narrative", ["business/narrative.md"]),
    ("03-financial-package", "scoup.ai financial package",
     [f"financial/{n}.md" for n in ("assumptions", "unit-economics", "budget", "use-of-funds", "scenarios", "audit")]),
    ("04-market-research", "scoup.ai market research",
     sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "research").glob("0[1-5]-*.md")) + ["research/open-questions.md"]),
    ("05-marketing-and-gtm", "scoup.ai marketing and go-to-market",
     ["marketing/marketing-plan.md", "marketing/gtm.md", "marketing/brand/README.md",
      "marketing/seo/keyword-research.md", "marketing/seo/content-plan.md", "marketing/seo/technical-checklist.md",
      "marketing/digital/channel-plan.md", "marketing/digital/cac-targets.md", "marketing/digital/creative-concepts.md"]),
    ("06-architecture-and-adrs", "scoup.ai architecture, decision records, innovation thesis and dashboard spec",
     [f"docs/architecture/{n}.md" for n in ("overview", "data-model", "api-surface", "dev-portal-drift")]
     + ["docs/adr/README.md"] + ADRS + ["docs/innovation-thesis.md", "docs/exec-dashboard-spec.md"]),
    ("07-venture-pipeline", "Venture pipeline: calibrated ranking and two build plans", list(EXTERNAL)),
]
# (source file, heading prefix) -> figure key; the figure goes at the end of that section
PLACES = {
    "business/business-plan.md": [("4. Competitive landscape", "feature-matrix"), ("6. Market", "sam-som"),
                                  ("The acquisition-cost problem", "cac-target-vs-ceiling"),
                                  ("9. Scenarios", "revenue-bull-base-bear"), ("11. Use of funds", "net-burn-runway"),
                                  ("13. Growth expectations", "revenue-accounts-base")],
    "financial/budget.md": [("Net burn by year", "net-burn-runway")],
    "financial/scenarios.md": [("Headline comparison", "revenue-bull-base-bear"), ("Base case", "revenue-accounts-base"),
                               ("Market size and share of SAM", "sam-som")],
    "research/03-feature-matrix.md": [("Matrix", "feature-matrix")],
    "research/05-market-size.md": [("4. TAM, SAM, SOM", "sam-som")],
    "marketing/digital/cac-targets.md": [("CAC ceilings", "cac-target-vs-ceiling")],
}

def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def src_path(rel):
    return EXTERNAL.get(rel, ROOT / rel)

def git(*a):
    return subprocess.run(["git", "-C", str(ROOT), *a], capture_output=True, text=True, check=True).stdout.strip()

# ---------------------------------------------------------------- markdown -> html

def place_figures(rel, text):
    lines = text.splitlines()
    for prefix, key in reversed(PLACES.get(rel, [])):
        for i, ln in enumerate(lines):
            m = re.match(r"^(#+)\s+(.*)$", ln)
            if m and m.group(2).strip().startswith(prefix):
                lvl, j = len(m.group(1)), i + 1
                while j < len(lines):
                    m2 = re.match(r"^(#+)\s", lines[j])
                    if m2 and len(m2.group(1)) <= lvl:
                        break
                    j += 1
                lines[j:j] = ["", f"FIGPLACEHOLDER{key}FIGEND", ""]
                break
        else:
            raise SystemExit(f"figure anchor not found: {rel} § {prefix}")
    return "\n".join(lines)

def render_doc(rel, prefix):
    text = src_path(rel).read_text(encoding="utf-8-sig")
    text = place_figures(rel, text)
    md = markdown.Markdown(extensions=["tables", "fenced_code", "toc", "sane_lists"])
    body = md.convert(text)
    body = re.sub(r'id="([^"]+)"', lambda m: f'id="{prefix}-{m.group(1)}"', body)
    body = re.sub(r'href="#([^"]+)"', lambda m: f'href="#{prefix}-{m.group(1)}"', body)
    # links to repository files do not resolve inside a PDF: keep the text, drop the link
    body = re.sub(r'<a href="(?!https?:|mailto:|#)[^"]*">(.*?)</a>', r'<span class="xref">\1</span>', body, flags=re.S)
    body = body.replace('<pre><code class="language-mermaid">',
                        '<p class="note">Diagram source (Mermaid), shown as text; it is not rendered in this PDF.</p>'
                        '<pre><code class="language-mermaid">')
    toc = []
    def walk(tokens):
        for t in tokens:
            if t["level"] <= 2:
                toc.append((t["level"], f'{prefix}-{t["id"]}', html.unescape(t["name"])))
            walk(t["children"])
    walk(md.toc_tokens)
    return body, toc

FIG_HTML = ('<figure class="fig" id="fig-{n}"><img src="{src}" alt="Figure {n}: {alt}">'
            '<figcaption><b>Figure {n}:</b> {title}. Source: {source}</figcaption></figure>')

def css(foot):
    font = (HERE / "fonts").as_uri()
    return f"""
@font-face {{ font-family: "Inter"; font-weight: 100 900; font-style: normal; src: url("{font}/inter-latin-wght-normal.woff2") format("woff2"); }}
@font-face {{ font-family: "Inter"; font-weight: 100 900; font-style: normal; src: url("{font}/inter-latin-ext-wght-normal.woff2") format("woff2"); unicode-range: U+0100-024F, U+1E00-1EFF, U+20A0-20CF, U+2C60-2C7F; }}
@font-face {{ font-family: "Inter"; font-weight: 100 900; font-style: italic; src: url("{font}/inter-latin-wght-italic.woff2") format("woff2"); }}
:root {{ --ink:#0f172a; --teal:#0f766e; --muted:#64748b; --rule:#e2e8f0; --tint:#f0fdfa; }}
@page {{ size: A4; margin: 20mm 18mm 18mm 18mm;
  @bottom-left {{ content: "{foot}"; font: 8pt Inter, "Segoe UI", sans-serif; color: #64748b; }}
  @bottom-right {{ content: "Page " counter(page) " of " counter(pages); font: 8pt Inter, "Segoe UI", sans-serif; color: #64748b; }} }}
@page :first {{ @bottom-left {{ content: none; }} @bottom-right {{ content: none; }} }}
html {{ font-family: Inter, "Segoe UI", Arial, sans-serif; font-size: 9.5pt; line-height: 1.5; color: var(--ink); }}
body {{ margin: 0; background: #fff; }}
h1, h2, h3, h4 {{ line-height: 1.25; break-after: avoid; }}
h1 {{ font-size: 18pt; font-weight: 650; color: var(--ink); border-bottom: 2px solid var(--teal); padding-bottom: 4pt; margin: 0 0 10pt; }}
h2 {{ font-size: 13pt; font-weight: 600; color: var(--teal); margin: 16pt 0 6pt; }}
h3 {{ font-size: 11pt; font-weight: 600; margin: 12pt 0 4pt; }}
h4 {{ font-size: 10pt; font-weight: 600; margin: 10pt 0 4pt; }}
p, li {{ orphans: 3; widows: 3; }}
a {{ color: var(--teal); text-decoration: none; }}
code {{ font-family: Consolas, "Cascadia Mono", monospace; font-size: 8.3pt; background: #f1f5f9; padding: 0 2px; border-radius: 2px; }}
pre {{ background: #f8fafc; border: 1px solid var(--rule); padding: 6pt 8pt; white-space: pre-wrap; word-break: break-word; font-size: 7.8pt; }}
pre code {{ background: none; padding: 0; }}
blockquote {{ margin: 8pt 0; padding: 4pt 10pt; border-left: 3px solid var(--teal); background: var(--tint); color: #334155; }}
table {{ border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 7.6pt; line-height: 1.35; break-inside: auto; }}
thead {{ display: table-header-group; }}
tr {{ break-inside: avoid; }}
th {{ background: #f1f5f9; font-weight: 600; text-align: left; }}
th, td {{ border: 1px solid var(--rule); padding: 3pt 4pt; vertical-align: top; overflow-wrap: anywhere; }}
.xref {{ color: #334155; }}
.note {{ color: var(--muted); font-size: 8pt; font-style: italic; margin-bottom: 2pt; }}
.fig {{ margin: 10pt 0 12pt; break-inside: avoid; }}
.fig img {{ width: 100%; max-height: 200mm; object-fit: contain; display: block; }}
.fig figcaption {{ font-size: 8pt; color: #334155; margin-top: 4pt; }}
.doc {{ break-before: page; }}
.title {{ height: 250mm; display: flex; flex-direction: column; justify-content: space-between; }}
.title .brand {{ font-size: 13pt; font-weight: 600; color: var(--teal); letter-spacing: 0.02em; }}
.title h1.name {{ font-size: 26pt; border: none; margin: 40mm 0 6mm; padding: 0; }}
.title .date {{ font-size: 11pt; color: var(--muted); }}
.title .disc {{ font-size: 11pt; font-weight: 600; border-left: 3px solid var(--teal); padding: 6pt 10pt; background: var(--tint); margin-top: 10mm; }}
.title .incl {{ font-size: 8.5pt; color: var(--muted); }}
.title .incl ul {{ margin: 4pt 0 0; padding-left: 14pt; }}
nav.toc {{ break-before: page; }}
nav.toc h1 {{ font-size: 16pt; }}
nav.toc ol {{ list-style: none; padding: 0; margin: 0; }}
nav.toc li a {{ display: flex; color: var(--ink); align-items: baseline; }}
nav.toc li.l1 {{ font-weight: 600; margin-top: 5pt; }}
nav.toc li.l2 {{ padding-left: 12pt; font-size: 8.6pt; }}
nav.toc .t {{ flex: 0 1 auto; }}
nav.toc .dots {{ flex: 1 1 auto; border-bottom: 1px dotted #94a3b8; margin: 0 4pt; min-width: 12pt; }}
nav.toc .pg {{ flex: 0 0 auto; min-width: 18pt; text-align: right; font-variant-numeric: tabular-nums; }}
"""

# ---------------------------------------------------------------- volumes

def assemble(name, title, sources, figs, commit):
    """Return (html_template_with_{PG:id}_slots, toc entries, figures used in order)."""
    docs, toc, used = [], [], []
    for k, rel in enumerate(sources):
        body, t = render_doc(rel, f"d{k + 1}")
        def fig(m):
            f = figs[m.group(1)]
            used.append(f)
            n = len(used)
            return FIG_HTML.format(n=n, src=(FIGDIR / f"{f['key']}.svg").as_uri(), alt=html.escape(f["title"]),
                                   title=html.escape(f["title"]), source=html.escape(f["source"]))
        body = re.sub(r"<p>FIGPLACEHOLDER(.+?)FIGEND</p>", fig, body)
        docs.append(f'<section class="doc" data-src="{html.escape(rel)}">{body}</section>')
        toc += t
    items = "\n".join(
        f'<li class="l{lvl}"><a href="#{i}"><span class="t">{html.escape(txt)}</span><span class="dots"></span>'
        f'<span class="pg">{{PG:{i}}}</span></a></li>' for lvl, i, txt in toc)
    incl = "".join(f"<li>{html.escape(r)}</li>" for r in sources)
    foot = title.replace('"', "'")
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{html.escape(title)}</title>
<style>{css(foot)}</style></head><body>
<section class="title"><div><div class="brand">scoup.ai</div><h1 class="name">{html.escape(title)}</h1>
<div class="date">{DATE}</div><div class="disc">{DISCLAIMER}</div></div>
<div class="incl">Documents in this volume:<ul>{incl}</ul>
<p>Generated from source by tools/pdf/build.py at source commit {commit[:12]}. Figures are drawn from source data at build time.</p></div></section>
<nav class="toc"><h1>Contents</h1><ol>{items}</ol></nav>
{''.join(docs)}
</body></html>"""
    return page, toc, used

def edge_print(html_path, pdf_path, profile):
    if profile.exists():
        shutil.rmtree(profile, ignore_errors=True)
    cmd = [str(EDGE), "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
           "--disable-extensions", "--run-all-compositor-stages-before-draw", "--virtual-time-budget=15000",
           "--no-pdf-header-footer", f"--user-data-dir={profile}", f"--print-to-pdf={pdf_path}", html_path.as_uri()]
    if pdf_path.exists():
        pdf_path.unlink()
    subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if not pdf_path.exists() or pdf_path.stat().st_size == 0:
        raise SystemExit(f"Edge did not write {pdf_path}")

def dest_pages(pdf):
    r = PdfReader(str(pdf))
    return {k.lstrip("/"): r.get_destination_page_number(v) + 1 for k, v in r.named_destinations.items()}, r

def build_volume(name, title, sources, figs, commit):
    page, toc, used = assemble(name, title, sources, figs, commit)
    ids = [i for _, i, _ in toc]
    pg = {i: "000" for i in ids}
    hpath, pdf = CACHE / "html" / f"{name}.html", OUT / f"{name}.pdf"
    hpath.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(1, 5):
        hpath.write_text(re.sub(r"\{PG:([^}]+)\}", lambda m: pg[m.group(1)], page), encoding="utf-8")
        edge_print(hpath, pdf, CACHE / f"edge-profile-{name}")
        dests, reader = dest_pages(pdf)
        missing = [i for i in ids if i not in dests]
        if missing:
            raise SystemExit(f"{name}: TOC targets without a PDF destination: {missing[:5]}")
        new = {i: str(dests[i]) for i in ids}
        if new == pg:
            break
        pg = new
    else:
        raise SystemExit(f"{name}: TOC page numbers did not converge")
    # verify: every TOC link annotation points at an existing destination; printed numbers match
    names = set(dests)
    links = 0
    for p in reader.pages:
        for a in p.get("/Annots") or []:
            a = a.get_object()
            d = a.get("/Dest")
            if a.get("/Subtype") == "/Link" and d is not None:
                links += 1
                if str(d).lstrip("/") not in names:
                    raise SystemExit(f"{name}: dangling internal link {d}")
    text1 = reader.pages[0].extract_text()
    ok_title = DISCLAIMER in " ".join(text1.split()) and DATE in text1
    if not ok_title:
        raise SystemExit(f"{name}: title page text check failed")
    return dict(name=name, title=title, sources=sources, pages=len(reader.pages), toc_entries=len(ids),
                internal_links=links, toc_passes=attempt, figures=[(n + 1, f["key"], f["title"]) for n, f in enumerate(used)],
                size=pdf.stat().st_size, title_ok=ok_title)

# ---------------------------------------------------------------- manifest

def edge_version():
    vs = [p.name for p in EDGE.parent.iterdir() if re.fullmatch(r"\d+\.\d+\.\d+\.\d+", p.name)]
    return max(vs, key=lambda v: tuple(map(int, v.split(".")))) if vs else "unknown"

def fmt(v):
    return f"{v:g}" if isinstance(v, float) else str(v)

def manifest(vols, figs, commit, dirty, data_sources):
    L = ["# PDF document set: manifest", "",
         f"Date: {DATE}. Generated by `tools/pdf/build.py`; do not edit by hand. {DISCLAIMER}", "",
         f"- Source commit (last commit touching any repository source file): `{commit}`"
         + (" (sources have uncommitted changes)" if dirty else ""),
         f"- Renderer: Microsoft Edge {edge_version()} headless `--print-to-pdf --no-pdf-header-footer`",
         f"- Python packages: see `tools/pdf/requirements.txt` (hash-pinned); typeface Inter (vendored, OFL) in `tools/pdf/fonts/`",
         f"- Number checks: {sum(c['ok'] for c in F.CHECKS)} of {len(F.CHECKS)} pass", "",
         "## PDFs", "",
         "| PDF | Pages | Figures | TOC entries | Internal links checked | Size (bytes) |", "|---|---|---|---|---|---|"]
    for v in vols:
        L.append(f"| {v['name']}.pdf | {v['pages']} | {len(v['figures'])} | {v['toc_entries']} | {v['internal_links']} | {v['size']} |")
    for v in vols:
        L += ["", f"### {v['name']}.pdf: {v['title']}", "",
              f"{v['pages']} pages. Title page checked for the date and the line \"{DISCLAIMER}\". "
              f"Table of contents: {v['toc_entries']} entries, page numbers read back from the PDF's named destinations "
              f"({v['toc_passes']} render passes); every internal link resolves to a destination.", "",
              "Figures:" if v["figures"] else "Figures: none (no chartable source data in these documents).", ""]
        for n, key, title in v["figures"]:
            L.append(f"- Figure {n}: {title} (`figures/{key}.svg`, checks below under `{key}`)")
        L += ["", "Source files:", "", "| File | SHA-256 | Last commit |", "|---|---|---|"]
        for rel in v["sources"]:
            p = src_path(rel)
            last = "outside repository, not committed" if rel in EXTERNAL else git("log", "-1", "--format=%h", "--", rel)
            L.append(f"| {p if rel in EXTERNAL else rel} | `{sha(p)[:16]}` | {last} |")
    L += ["", "## Figures", "", "| Figure file | SHA-256 | Data sources |", "|---|---|---|"]
    for f in figs.values():
        L.append(f"| figures/{f['key']}.svg | `{sha(FIGDIR / (f['key'] + '.svg'))[:16]}` | {f['source']} |")
    L.append(f"| figures/figure-data.json | `{sha(FIGDIR / 'figure-data.json')[:16]}` | every plotted value, as read |")
    L += ["", "Data files read for figures:", ""]
    for rel in data_sources:
        L.append(f"- `{rel}` sha256 `{sha(ROOT / rel)[:16]}`")
    L += ["", "## Number checks", "",
          "Each plotted value next to the same value read from a second source. Tolerances follow the rounding of the source "
          "(two decimals in $M tables, one decimal in $K tables, whole numbers in headline rows). The CAC ceiling check allows "
          "for the gross margin being printed to three decimals.", "",
          "| Figure | Item | Plotted | Source value | Source | Tolerance | Result |", "|---|---|---|---|---|---|---|"]
    for c in F.CHECKS:
        L.append(f"| {c['figure']} | {c['item']} | {fmt(c['plotted'])} | {fmt(c['source'])} | {c['source_ref']} | "
                 f"{fmt(c['tolerance'])} | {'pass' if c['ok'] else 'FAIL'} |")
    return "\n".join(L) + "\n"

# ---------------------------------------------------------------- main

def main():
    for rel, p in EXTERNAL.items():
        if not p.exists():
            raise SystemExit(f"missing external source {p}")
    if not EDGE.exists():
        raise SystemExit(f"Microsoft Edge not found at {EDGE}; set PDF_EDGE")
    repo_sources = sorted({r for _, _, s in VOLUMES for r in s if r not in EXTERNAL})
    data_sources = ["financial/tools/verify_results.json", "financial/scenarios.md", "financial/budget.md",
                    "research/05-market-size.md", "research/03-feature-matrix.md", "marketing/digital/cac-targets.md"]
    commit = git("log", "-1", "--format=%H", "--", *repo_sources, *data_sources)
    dirty = bool(git("status", "--porcelain", "--", *repo_sources, *data_sources))
    if FIGDIR.exists():
        shutil.rmtree(FIGDIR)
    FIGDIR.mkdir(parents=True)
    F.setup_fonts(CACHE / "fonts")
    figs = {}
    for fn in F.ALL:
        f = fn(FIGDIR)
        figs[f["key"]] = f
    (FIGDIR / "figure-data.json").write_text(
        json.dumps({k: dict(title=f["title"], source=f["source"], data=f["data"]) for k, f in figs.items()},
                   indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    bad = [c for c in F.CHECKS if not c["ok"]]
    if bad:
        for c in bad:
            print("CHECK FAILED:", c)
        raise SystemExit(f"{len(bad)} number checks failed")
    vols = []
    only = set(sys.argv[1:])
    for name, title, sources in VOLUMES:
        if only and name not in only:
            continue
        v = build_volume(name, title, sources, figs, commit)
        print(f"{name}.pdf: {v['pages']} pages, {len(v['figures'])} figures, {v['toc_entries']} TOC entries")
        vols.append(v)
    if not only:
        (OUT / "MANIFEST.md").write_text(manifest(vols, figs, commit, dirty, data_sources), encoding="utf-8")
    print(f"{len(F.CHECKS)} number checks pass")

if __name__ == "__main__":
    main()
