"""Source-generated figures for the scoup.ai PDF set.

Every plotted number is read from a source file at build time. Each figure also records
number checks: the plotted value next to the same value parsed from a second source
(usually the markdown table a reader sees). build.py fails if any check fails.
"""
import json, re
from pathlib import Path

import matplotlib
matplotlib.use("svg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import font_manager
from matplotlib.patches import Rectangle

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent

# Categorical palette, validated with the dataviz validator (light mode, all checks pass):
# teal-600 (close to brand teal #0f766e, which fails the chroma floor as a fill), blue, amber.
C1, C2, C3 = "#0d9488", "#4f6bd8", "#d97706"
INK, MUTED, GRID = "#0f172a", "#64748b", "#e2e8f0"
YRS = [f"Y{i}" for i in range(1, 8)]

# ---------------------------------------------------------------- source parsing

def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8-sig")

def section(rel, prefix):
    """Text of the section whose heading starts with prefix, up to the next heading of the same or higher level."""
    lines = read(rel).splitlines()
    for i, ln in enumerate(lines):
        m = re.match(r"^(#+)\s+(.*)$", ln)
        if m and m.group(2).strip().startswith(prefix):
            lvl = len(m.group(1))
            j = i + 1
            while j < len(lines):
                m2 = re.match(r"^(#+)\s", lines[j])
                if m2 and len(m2.group(1)) <= lvl:
                    break
                j += 1
            return "\n".join(lines[i + 1:j])
    raise KeyError(f"{rel}: no section starting with {prefix!r}")

def tables(text):
    out, cur = [], []
    for ln in text.splitlines():
        s = ln.strip()
        if s.startswith("|"):
            cells = [c.strip() for c in s.strip("|").split("|")]
            if all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                continue
            cur.append(cells)
        elif cur:
            out.append(cur); cur = []
    if cur:
        out.append(cur)
    return out

def row(table, label):
    for r in table:
        if r[0].replace("*", "").strip().startswith(label):
            return r
    raise KeyError(label)

def nums(cell):
    return [float(x.replace(",", "")) for x in re.findall(r"-?\d[\d,]*(?:\.\d+)?", cell)]

def model():
    return json.loads(read("financial/tools/verify_results.json"))

# ---------------------------------------------------------------- checks

CHECKS = []

def check(fig, item, plotted, source_value, source_ref, tol):
    ok = source_value is not None and abs(float(plotted) - float(source_value)) <= tol + 1e-9
    CHECKS.append(dict(figure=fig, item=item, plotted=round(float(plotted), 4),
                       source=source_value, source_ref=source_ref, tolerance=tol, ok=bool(ok)))

def check_text(fig, item, plotted, source_value, source_ref):
    CHECKS.append(dict(figure=fig, item=item, plotted=plotted, source=source_value,
                       source_ref=source_ref, tolerance="exact", ok=plotted == source_value))

# ---------------------------------------------------------------- style

def setup_fonts(cache):
    """Instance the vendored Inter variable font (OFL) to static TTFs matplotlib can read."""
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
    cache.mkdir(parents=True, exist_ok=True)
    names = {}
    for wght, tag in ((400, "Regular"), (600, "SemiBold")):
        out = cache / f"Inter-{tag}.ttf"
        if not out.exists():
            f = TTFont(HERE / "fonts" / "inter-latin-wght-normal.woff2")
            inst = instancer.instantiateVariableFont(f, {"wght": wght}, updateFontNames=True)
            inst.flavor = None
            inst.save(out)
        font_manager.fontManager.addfont(str(out))
        names[tag] = font_manager.FontProperties(fname=str(out)).get_name()
    plt.rcParams.update({
        "font.family": names["Regular"], "font.size": 9,
        "svg.fonttype": "path", "svg.hashsalt": "scoup-pdf-set",
        "axes.edgecolor": MUTED, "axes.labelcolor": INK, "text.color": INK,
        "xtick.color": MUTED, "ytick.color": MUTED, "axes.spines.top": False,
        "axes.spines.right": False, "axes.grid": True, "axes.grid.axis": "y",
        "grid.color": GRID, "grid.linewidth": 0.8, "axes.axisbelow": True,
        "legend.frameon": False, "axes.titlesize": 10, "axes.titleweight": "semibold",
        "axes.titlelocation": "left",
    })
    return names

def save(fig, path):
    fig.savefig(path, format="svg", bbox_inches="tight",
                metadata={"Date": None, "Creator": "tools/pdf/build.py"})
    plt.close(fig)

def stacked(ax, series, labels, colors, fmt):
    x = np.arange(len(YRS)); bottom = np.zeros(len(YRS))
    for vals, lab, col in zip(series, labels, colors):
        ax.bar(x, vals, 0.62, bottom=bottom, color=col, label=lab, edgecolor="white", linewidth=1.5)
        bottom += np.array(vals)
    for xi, tot in zip(x, bottom):
        ax.text(xi, tot, fmt(tot), ha="center", va="bottom", fontsize=7.5, color=INK)
    ax.set_xticks(x, YRS)
    ax.margins(y=0.12)

SC = (("bull", "Bull", C1), ("base", "Base", C2), ("bear", "Bear", C3))

# ---------------------------------------------------------------- figures

def fig_revenue_accounts(out):
    key = "revenue-accounts-base"
    b = model()["base"]
    rev = {s: [v / 1000 for v in b[f"Revenue|rev_{s}"]] for s in ("shp", "imp", "car")}
    acc = {s: [float(v) for v in b[f"Revenue|end_{s}"]] for s in ("shp", "imp", "car")}
    t = tables(section("financial/scenarios.md", "Base case"))[0]
    ref = "financial/scenarios.md § Base case"
    for s, lab in (("shp", "shippers"), ("imp", "SME importers"), ("car", "carriers")):
        src_r = nums(" ".join(row(t, f"Revenue: {lab}")[1:]))
        src_a = nums(" ".join(row(t, f"Accounts at year end: {lab}")[1:]))
        for i in range(7):
            check(key, f"revenue {lab} {YRS[i]} ($M)", rev[s][i], src_r[i], ref, 0.005)
            check(key, f"accounts {lab} {YRS[i]}", acc[s][i], src_a[i], ref, 0)
    tot = nums(" ".join(row(t, "Revenue: total")[1:]))
    for i in range(7):
        check(key, f"revenue total {YRS[i]} ($M)", sum(rev[s][i] for s in rev), tot[i], ref, 0.005)
    labels = ["Mid-market shippers", "SME importers", "Carriers (partner channel)"]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(7.4, 3.0))
    stacked(a1, [rev["shp"], rev["imp"], rev["car"]], labels, [C1, C2, C3], lambda v: f"{v:.2f}" if v < 1 else f"{v:.1f}")
    a1.set_title("Revenue by segment ($M)")
    stacked(a2, [acc["shp"], acc["imp"], acc["car"]], labels, [C1, C2, C3], lambda v: f"{v:,.0f}")
    a2.set_title("Accounts at year end")
    h, l = a1.get_legend_handles_labels()
    fig.legend(h, l, loc="lower center", ncol=3, bbox_to_anchor=(0.5, -0.02), fontsize=8)
    fig.tight_layout(rect=(0, 0.07, 1, 1))
    save(fig, out / f"{key}.svg")
    return dict(key=key, title="Base-case revenue and accounts at year end by segment, years 1 to 7",
                source="financial/tools/verify_results.json § base (recomputed financial/model.xlsx); checked against financial/scenarios.md § Base case",
                data=dict(revenue_musd=rev, accounts=acc))

def fig_scenarios(out):
    key = "revenue-bull-base-bear"
    m = model()
    rev = {s: [v / 1000 for v in m[s]["Revenue|rev"]] for s, _, _ in SC}
    head = tables(section("financial/scenarios.md", "Headline comparison"))[0]
    hr = row(head, "Revenue Y1 / Y3 / Y5 / Y7")
    for ci, (s, lab, _) in enumerate(SC):
        t = tables(section("financial/scenarios.md", f"{lab} case"))[0]
        src = nums(" ".join(row(t, "Revenue: total")[1:]))
        for i in range(7):
            check(key, f"{lab} revenue {YRS[i]} ($M)", rev[s][i], src[i], f"financial/scenarios.md § {lab} case", 0.005)
        for yi, v in zip((0, 2, 4, 6), nums(hr[1 + ci])):
            check(key, f"{lab} revenue {YRS[yi]} ($M, headline)", rev[s][yi], v, "financial/scenarios.md § Headline comparison", 0.005)
    fig, ax = plt.subplots(figsize=(7.2, 3.1))
    x = np.arange(7); w = 0.26
    for k, (s, lab, col) in enumerate(SC):
        ax.bar(x + (k - 1) * w, rev[s], w, color=col, label=lab, edgecolor="white", linewidth=1.2)
        ax.text(6 + (k - 1) * w, rev[s][6], f"{rev[s][6]:.1f}", ha="center", va="bottom", fontsize=7.5)
    ax.set_xticks(x, YRS); ax.set_ylabel("Revenue ($M)")
    ax.set_title("Revenue by year: bull, base and bear ($M)")
    ax.legend(loc="upper left", fontsize=8)
    fig.tight_layout()
    save(fig, out / f"{key}.svg")
    return dict(key=key, title="Revenue by year in the bull, base and bear cases",
                source="financial/tools/verify_results.json § bull, base, bear; checked against financial/scenarios.md § Bull case, Base case, Bear case and § Headline comparison",
                data=dict(revenue_musd=rev))

def fig_burn(out):
    key = "net-burn-runway"
    m = model()
    burn = {s: [float(v) for v in m[s]["Cash Flow|burn"]] for s, _, _ in SC}
    runway = {s: m[s]["Cash Flow|runway"] for s, _, _ in SC}
    head = tables(section("financial/scenarios.md", "Headline comparison"))[0]
    hb = row(head, "Average monthly net burn Y1 / Y2 / Y3 / Y4")
    hrw = row(head, "Seed-only runway")
    bud = nums(" ".join(row(tables(section("financial/budget.md", "Net burn by year"))[0], "Average monthly net burn")[1:]))
    for i in range(7):
        check(key, f"Base burn {YRS[i]} ($K/month)", burn["base"][i], bud[i], "financial/budget.md § Net burn by year", 0.05)
    for ci, (s, lab, _) in enumerate(SC):
        for i, v in enumerate(nums(hb[1 + ci])):
            check(key, f"{lab} burn {YRS[i]} ($K/month, headline)", burn[s][i], v, "financial/scenarios.md § Headline comparison", 0.5)
        fcf = nums(" ".join(row(tables(section("financial/scenarios.md", f"{lab} case"))[0], "Free cash flow")[1:]))
        for i in range(7):
            check(key, f"{lab} burn {YRS[i]} vs max(0, -FCF)/12 ($K/month)", burn[s][i], max(0.0, -fcf[i] * 1000) / 12,
                  f"financial/scenarios.md § {lab} case (Free cash flow row)", 0.5)
        src_rw = hrw[1 + ci]
        mv = runway[s]
        if isinstance(mv, str):
            check_text(key, f"{lab} seed-only runway", mv.replace("month ", ""), src_rw, "financial/scenarios.md § Headline comparison")
        else:
            check(key, f"{lab} seed-only runway (months)", mv, nums(src_rw)[0], "financial/scenarios.md § Headline comparison", 0)
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(7.4, 3.0), gridspec_kw=dict(width_ratios=[2.3, 1]))
    x = np.arange(7); w = 0.26
    for k, (s, lab, col) in enumerate(SC):
        a1.bar(x + (k - 1) * w, burn[s], w, color=col, label=lab, edgecolor="white", linewidth=1.2)
    a1.set_xticks(x, YRS); a1.set_title("Average monthly net burn ($K)")
    a1.legend(loc="upper left", fontsize=8)
    labs, vals, txt = [], [], []
    for s, lab, col in SC:
        v = runway[s]
        labs.append(lab)
        if isinstance(v, str):
            vals.append(84); txt.append("beyond 84")
        else:
            vals.append(v); txt.append(f"{v:.0f}")
    y = np.arange(3)[::-1]
    a2.barh(y, vals, 0.55, color=[c for _, _, c in SC], edgecolor="white")
    for yi, v, t in zip(y, vals, txt):
        a2.text(v + 1.5, yi, t, va="center", fontsize=8)
    a2.set_yticks(y, labs); a2.set_xlim(0, 112); a2.grid(axis="x"); a2.grid(axis="y", visible=False)
    a2.set_title("Seed-only runway (months)")
    fig.tight_layout()
    save(fig, out / f"{key}.svg")
    return dict(key=key, title="Average monthly net burn by year and seed-only runway (both tranches) in the three cases; the bull bar is drawn at the 84-month model horizon",
                source="financial/tools/verify_results.json § Cash Flow|burn, Cash Flow|runway; checked against financial/budget.md § Net burn by year and financial/scenarios.md § Headline comparison",
                data=dict(burn_kusd_per_month=burn, runway_months=runway))

def fig_market(out):
    key = "sam-som"
    rel = "research/05-market-size.md"; sec = "4. TAM, SAM, SOM"
    txt = section(rel, sec); t = tables(txt)[0]
    shp = nums(row(t, "Mid-market shippers")[3])[0]
    imp = nums(row(t, "SME ocean importers")[3])[0]
    sam = nums(row(t, "SAM")[3])[0]
    ref = f"{rel} § {sec}"
    check(key, "SAM = shipper + importer segments ($M)", shp + imp, sam, ref, 0.05)
    b = model()["base"]
    som_s = b["Revenue|rev_shp"][6] / 1000; som_i = b["Revenue|rev_imp"][6] / 1000
    m1 = re.search(r"(\d+) are direct accounts in the SAM \((\d+) mid-market shippers and (\d+) SME importers, \$([\d.]+)M revenue\)", txt)
    check(key, "SOM Y7 base direct revenue ($M)", som_s + som_i, float(m1.group(4)), ref + " (SOM bullet)", 0.005)
    check(key, "SOM Y7 shipper accounts", b["Revenue|end_shp"][6], float(m1.group(2)), ref + " (SOM bullet)", 0)
    check(key, "SOM Y7 importer accounts", b["Revenue|end_imp"][6], float(m1.group(3)), ref + " (SOM bullet)", 0)
    m2 = re.search(r"shippers \$([\d.]+)M / \$[\d.]+M = [\d.]+%; importers \$([\d.]+)M", txt)
    check(key, "SOM Y7 shipper revenue ($M)", som_s, float(m2.group(1)), ref + " (shares bullet)", 0.005)
    check(key, "SOM Y7 importer revenue ($M)", som_i, float(m2.group(2)), ref + " (shares bullet)", 0.005)
    m3 = re.search(r"direct \$[\d.]+M / \$[\d.]+M = ([\d.]+)% of SAM", txt)
    share = round((som_s + som_i) / sam * 100, 1)
    check(key, "SOM share of SAM revenue (%)", share, float(m3.group(1)), ref + " (shares bullet)", 0)
    fig, ax = plt.subplots(figsize=(7.2, 2.3))
    rows = [("SAM: serviceable market", shp, imp), ("SOM: base case, year 7", som_s, som_i)]
    for yi, (lab, a, c) in zip((1, 0), rows):
        ax.barh(yi, a, 0.5, color=C1, edgecolor="white", linewidth=1.5, label="Mid-market shippers" if yi else None)
        ax.barh(yi, c, 0.5, left=a, color=C2, edgecolor="white", linewidth=1.5, label="SME importers" if yi else None)
        note = "" if yi else f"  ({share}% of SAM revenue)"
        ax.text(a + c + 8, yi, f"${a + c:,.1f}M{note}", va="center", fontsize=8.5)
    ax.set_yticks([1, 0], [r[0] for r in rows]); ax.set_xlim(0, 1100)
    ax.grid(axis="x"); ax.grid(axis="y", visible=False); ax.set_xlabel("Annual revenue ($M)")
    ax.legend(loc="lower right", fontsize=8)
    fig.tight_layout()
    save(fig, out / f"{key}.svg")
    return dict(key=key, title="Serviceable market (SAM) against obtainable base-case revenue in year 7 (SOM), split by core segment",
                source=f"{rel} § {sec}; SOM from financial/tools/verify_results.json § base, checked against the same section",
                data=dict(sam_shippers=shp, sam_importers=imp, sam=sam, som_shippers=som_s, som_importers=som_i, som_share_pct=share))

def fig_cac(out):
    key = "cac-target-vs-ceiling"
    rel = "marketing/digital/cac-targets.md"; sec = "CAC ceilings"
    t = [x for x in tables(section(rel, sec)) if "Fully loaded ceiling" in x[0][1]][0]
    ref = f"{rel} § {sec}"
    rows = []
    for r in t[1:]:
        lab = re.sub(r"\s*\[assumed\]", "", r[0]).strip()
        m = re.search(r"=\s*(about\s*)?\$([\d,]+)", r[1])
        ceil = float(m.group(2).replace(",", "")); approx = bool(m.group(1))
        tgt = nums(r[2])[0]
        f = re.fullmatch(r"\$([\d,]+) × ([\d.]+) = \$([\d,]+)", r[1].strip())
        if f:
            # The margin is printed to 3 decimals, so the product can differ by up to revenue x 0.0005.
            rev = float(f.group(1).replace(",", ""))
            check(key, f"{lab}: ceiling = revenue × margin (margin rounded to 3 dp)", rev * float(f.group(2)), ceil, ref,
                  round(rev * 0.0005 + 1, 1))
        check(key, f"{lab}: media target = ceiling ÷ 3", ceil / 3, tgt, ref, 1)
        rows.append((lab + (" (est.)" if approx else ""), ceil, tgt))
    fig, ax = plt.subplots(figsize=(7.2, 3.4))
    y = np.arange(len(rows))[::-1]
    ax.barh(y + 0.18, [r[1] for r in rows], 0.34, color=C2, label="Payback ceiling, fully loaded (12-month gross-profit payback)", edgecolor="white")
    ax.barh(y - 0.18, [r[2] for r in rows], 0.34, color=C1, label="Media CAC target (one third of the ceiling)", edgecolor="white")
    for yi, (_, c, tg) in zip(y, rows):
        ax.text(c + 120, yi + 0.18, f"${c:,.0f}", va="center", fontsize=7.5)
        ax.text(tg + 120, yi - 0.18, f"${tg:,.0f}", va="center", fontsize=7.5)
    ax.set_yticks(y, [r[0] for r in rows], fontsize=8)
    ax.set_xlim(0, 15500); ax.grid(axis="x"); ax.grid(axis="y", visible=False)
    ax.set_xlabel("US dollars per new account")
    ax.legend(loc="lower center", bbox_to_anchor=(0.4, 1.0), ncol=1, fontsize=7.5)
    fig.tight_layout()
    save(fig, out / f"{key}.svg")
    return dict(key=key, title="Acquisition-cost target against the payback ceiling for importer and shipper accounts; carriers are not shown because the source gives only a media target for them",
                source=ref, data=dict(rows=[dict(account=a, ceiling=c, target=tg) for a, c, tg in rows]))

def fig_matrix(out):
    key = "feature-matrix"
    rel = "research/03-feature-matrix.md"
    mt = tables(section(rel, "Matrix"))[0]
    codes = {r[0]: r[1] for r in tables(section(rel, "Columns"))[0][1:]}
    head, body = mt[0], mt[1:]
    for r in body:
        check(key, f"{r[0]}: cells", len(r) - 1, len(head) - 1, f"{rel} § Matrix", 0)
    check(key, "capability codes in legend", len(codes), len(head) - 1, f"{rel} § Columns", 0)
    style = {"yes": (C1, "white"), "partial": ("#ccfbf1", INK), "no": ("#f1f5f9", MUTED), "unknown": ("white", "#94a3b8")}
    nc, nr = len(head) - 1, len(body)
    cw, rh, lw = 0.42, 0.28, 1.75
    W = lw + nc * cw
    legend_rows = (len(codes) + 1) // 2
    H = (nr + 1) * rh + 0.25 + legend_rows * 0.17 + 0.1
    fig = plt.figure(figsize=(W, H)); ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, W); ax.set_ylim(H, 0); ax.axis("off"); ax.grid(False)
    for j, c in enumerate(head[1:]):
        ax.text(lw + j * cw + cw / 2, rh / 2, c, ha="center", va="center", fontsize=7.5, fontweight="semibold")
    counts = {}
    for i, r in enumerate(body):
        y0 = (i + 1) * rh
        ax.text(lw - 0.06, y0 + rh / 2, r[0], ha="right", va="center", fontsize=7,
                fontweight="semibold" if r[0].startswith("scoup.ai") else "normal")
        for j, v in enumerate(r[1:]):
            fc, tc = style[v]
            counts[v] = counts.get(v, 0) + 1
            ax.add_patch(Rectangle((lw + j * cw + 0.015, y0 + 0.015), cw - 0.03, rh - 0.03, facecolor=fc, edgecolor=GRID, linewidth=0.6))
            ax.text(lw + j * cw + cw / 2, y0 + rh / 2, v, ha="center", va="center", fontsize=4.8, color=tc)
    y = (nr + 1) * rh + 0.2
    for k, (c, cap) in enumerate(codes.items()):
        col, rr = divmod(k, legend_rows)
        ax.text(0.05 + col * W / 2, y + rr * 0.17, f"{c}  {cap}", fontsize=5.4, color=INK, va="top")
    save(fig, out / f"{key}.svg")
    return dict(key=key, title="Competitor feature matrix (yes, partial, no or unknown per capability C1 to C13); the scoup.ai row is pre-product code tested on synthetic data only",
                source=f"{rel} § Matrix and § Columns", data=dict(header=head, rows=body, codes=codes, cell_counts=counts))

ALL = [fig_revenue_accounts, fig_scenarios, fig_burn, fig_market, fig_cac, fig_matrix]
