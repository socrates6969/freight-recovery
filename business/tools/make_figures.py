"""Build the investor figures under business/figures/.

Every number drawn here comes from one of two places:
  * MODEL: business/investor-pack/scoup-financial-model.xlsx, recalculated outside Excel
    on 2026-10-22 with business/tools/recalc_model.py (values pasted below).
  * SOURCE: a public figure listed in business/data-and-sources.md.
Illustrative figures say so on the chart itself.

Run: python business/tools/make_figures.py   (needs matplotlib)
"""
import textwrap
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import FancyBboxPatch  # noqa: E402
from matplotlib.text import Text  # noqa: E402

# Dollar amounts are text, not math: render every label literally.
_init = Text.__init__


def _literal_init(self, *args, **kwargs):
    kwargs.setdefault("parse_math", False)
    _init(self, *args, **kwargs)


Text.__init__ = _literal_init

OUT = Path(__file__).resolve().parents[1] / "figures"
OUT.mkdir(exist_ok=True)

INK = "#1f2933"
MUTED = "#6b7785"
ACCENT = "#1b6ca8"
ACCENT2 = "#e07a2e"
PALE = "#9fb7cc"
GRID = "#d9dee4"

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 10,
    "axes.edgecolor": GRID,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "svg.fonttype": "none",
})

YEARS = ["Y1", "Y2", "Y3", "Y4", "Y5", "Y6", "Y7"]

# MODEL values ($M), recalculated 2026-10-22.
REVENUE_BASE = [0.039, 0.367, 1.511, 3.721, 7.300, 11.519, 16.432]
ARR = {
    "Upside": [0.120, 0.967, 3.526, 7.829, 14.346, 21.626, 30.001],
    "Base": [0.078, 0.626, 2.256, 4.929, 9.025, 13.490, 18.634],
    "Downside": [0.042, 0.272, 0.841, 1.737, 3.025, 4.345, 5.790],
}
PLATFORM_FEE = [0, 6, 10, 13, 15, 16, 17]          # $K per account per year
RECOVERED = [52, 70, 85, 95, 105, 110, 115]        # $K recovered for the customer
SHARE = [0.25, 0.17, 0.14, 0.12, 0.12, 0.12, 0.12]  # scoup.ai's share of recoveries

# SOURCE + MODEL values for the market chart ($B per year). Keep in step with data-and-sources.md.
MARKET = [
    ("US business logistics costs, 2025", 2400.0, "CSCMP / Kearney"),
    ("US truck transport spend, 2025", 883.2, "36.8% of the above"),
    ("Truck detention cost, 2023", 15.1, "ATRI; cost of waiting, not recoverable"),
    ("Ocean D&D billed by 9 carriers", 3.08, "FMC; 5-year average, mostly owed"),
    ("TAM: scoup.ai fee pool, all segments", 1.8555, "model"),
    ("SAM: shippers + SME importers", 0.9454, "model"),
]


def footer(fig, caption, source):
    fig.text(0.01, 0.075, textwrap.fill(caption, 130), fontsize=8.8, color=INK, va="bottom")
    fig.text(0.01, 0.012, textwrap.fill("Source: " + source, 160), fontsize=7.4, color=MUTED,
             va="bottom")


def save(fig, name):
    fig.savefig(OUT / f"{name}.png", dpi=160)
    fig.savefig(OUT / f"{name}.svg")
    plt.close(fig)


def market_size():
    fig, ax = plt.subplots(figsize=(9.5, 5))
    fig.subplots_adjust(left=0.3, right=0.97, top=0.9, bottom=0.25)
    rows = MARKET[::-1]
    labels = [r[0] for r in rows]
    vals = [r[1] for r in rows]
    colors = [ACCENT if lab.startswith(("SAM", "TAM")) else PALE for lab in labels]
    bars = ax.barh(labels, vals, color=colors)
    ax.set_xscale("log")
    ax.set_xlim(0.3, 60000)
    ax.set_xticks([1, 10, 100, 1000, 10000])
    ax.set_xticklabels(["$1B", "$10B", "$100B", "$1,000B", "$10,000B"])
    ax.minorticks_off()
    ax.set_xlabel("US$ billions per year (log scale)")
    for b, v, r in zip(bars, vals, rows):
        txt = f"${v:,.0f}B" if v >= 10 else f"${v:,.2f}B"
        ax.text(v * 1.1, b.get_y() + b.get_height() / 2, f"{txt}  {r[2]}", va="center",
                fontsize=8, color=INK)
    ax.set_title("Size of the problem vs. the fees scoup.ai could earn", loc="left", fontsize=12,
                 color=INK)
    footer(fig, "Grey bars describe spend and charges in the system; most of that money is "
                "correctly billed. Blue bars are the modelled fee pool (accounts x revenue per "
                "account). Only the blue bars are a market for scoup.ai.",
           "CSCMP/Kearney State of Logistics 2026; FMC detention & demurrage data (Apr 2020-Mar "
           "2025); ATRI (Sep 2024); SAM/TAM: research/05-market-size.md + model. Full list: "
           "business/data-and-sources.md")
    save(fig, "market-size")


def funnel():
    stages = [
        ("Invoices checked", 10000, "100% of invoices, not a sample"),
        ("Flagged by audit checks", 900, "9% flagged (assumption)"),
        ("Confirmed by reviewer", 450, "half of flags hold up (assumption)"),
        ("Claims paid", 270, "60% of filed claims paid (assumption)"),
    ]
    fig, ax = plt.subplots(figsize=(9, 4.8))
    fig.subplots_adjust(left=0.02, right=0.98, top=0.88, bottom=0.22)
    ax.axis("off")
    for i, (name, n, note) in enumerate(stages):
        w = 0.92 * (0.4 + 0.6 * (len(stages) - i) / len(stages))
        y = 0.78 - i * 0.235
        last = i == len(stages) - 1
        ax.add_patch(FancyBboxPatch((0.5 - w / 2, y), w, 0.18, boxstyle="round,pad=0.005",
                                    color=ACCENT if last else PALE))
        fg = "white" if last else INK
        ax.text(0.5, y + 0.115, f"{name}: {n:,}", ha="center", fontsize=11, color=fg,
                weight="bold")
        ax.text(0.5, y + 0.04, note, ha="center", fontsize=8.5, color=fg)
    ax.set_xlim(0, 1)
    ax.set_ylim(0.05, 1)
    ax.set_title("ILLUSTRATIVE overcharge funnel, one mid-size account, one year (not measured)",
                 loc="left", fontsize=11.5, color=INK)
    footer(fig, "The dollar end-point matches the model: $52K won in disputes in year 1 (plan input); "
                "scoup.ai keeps 25% = $13.0K. The flag, confirm and pay rates are placeholders that "
                "design-partner files must replace.",
           "scoup-financial-model.xlsx, Assumptions rows 13-16 (year 1). Stage rates: company "
           "assumptions, not observations.")
    save(fig, "overcharge-funnel")


def pipeline():
    steps = [
        ("1  Intake", "reads the carrier\ninvoice (EDI 210,\nCSV, fields)"),
        ("2  Contract\n& tariff", "picks contract,\nlane, fuel table,\nclaim deadline"),
        ("3  Audit\nchecks (code)", "re-rates: fuel,\nclass, reweigh,\ndetention, dupes"),
        ("4  Evidence", "attaches clause\nand documents\nto each finding"),
        ("5  Reviewer", "recomputes every\nfinding; checks\nthe claim window"),
        ("6  Claim\ndraft", "drafts a dispute\nfrom confirmed\nfindings only"),
        ("Person\napproves", "nothing is sent\nwithout sign-off"),
    ]
    fig, ax = plt.subplots(figsize=(11.5, 4.2))
    fig.subplots_adjust(left=0.01, right=0.99, top=0.88, bottom=0.24)
    ax.axis("off")
    n = len(steps)
    w = 0.118
    gap = (1 - n * w) / (n + 1)
    for i, (title, body) in enumerate(steps):
        x = gap + i * (w + gap)
        col = ACCENT2 if i == n - 1 else (INK if i == 2 else ACCENT)
        ax.add_patch(FancyBboxPatch((x, 0.1), w, 0.8, boxstyle="round,pad=0.01", color=col))
        ax.text(x + w / 2, 0.72, title, ha="center", va="center", color="white", fontsize=9,
                weight="bold")
        ax.text(x + w / 2, 0.33, body, ha="center", va="center", color="white", fontsize=7.4)
        if i < n - 1:
            ax.annotate("", xy=(x + w + gap * 0.95, 0.5), xytext=(x + w + gap * 0.05, 0.5),
                        arrowprops=dict(arrowstyle="->", color=INK, lw=1.5))
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_title("How the agents find an overcharge and turn it into a claim", loc="left",
                 fontsize=12, color=INK)
    footer(fig, "Money is computed by deterministic, tested code (dark). An optional language model "
                "only does judgment in Intake, Contract & tariff, Reviewer and Claim. The Reviewer recomputes every finding, the Claim "
                "agent drafts only from confirmed findings, and a person approves (orange). Code: "
                "unit-tested, not yet wired into the web app. Synthetic test only: 0 of 45 clean "
                "invoices claimed; 90 of 90 injected overcharges flagged to the cent.",
           "technical/agents.md (origin/master e3fef5f, 2026-10-22). Synthetic data; not a "
           "real-world performance claim.")
    save(fig, "agent-pipeline")


def unit_economics():
    share_part = [round(r * s, 1) for r, s in zip(RECOVERED, SHARE)]
    rpa = [round(f + p, 1) for f, p in zip(PLATFORM_FEE, share_part)]
    fig, ax = plt.subplots(figsize=(9, 5))
    fig.subplots_adjust(left=0.09, right=0.97, top=0.88, bottom=0.25)
    ax.bar(YEARS, share_part, color=ACCENT, label="Share of money recovered")
    ax.bar(YEARS, PLATFORM_FEE, bottom=share_part, color=ACCENT2, label="Platform fee")
    for i, v in enumerate(rpa):
        ax.text(i, v + 0.6, f"${v:.1f}K", ha="center", fontsize=9)
    ax.set_ylabel("Revenue per account, $K per year")
    ax.set_ylim(0, 36)
    ax.legend(frameon=False, loc="upper left")
    ax.yaxis.grid(True, color=GRID)
    ax.set_axisbelow(True)
    ax.set_title("Revenue per account, base case: fee plus a share of recoveries", loc="left",
                 fontsize=12, color=INK)
    footer(fig, "Year 3: $10K fee + 14% of $85K recovered = $21.9K. At 64% gross margin, 20% yearly "
                "churn and $0.68 of sales cost per $1 of new ARR, acquisition cost is repaid in about "
                "13 months. Every input is an assumption.",
           "scoup-financial-model.xlsx, Assumptions rows 13-16 and Unit economics sheet "
           "(recalculated 2026-10-22).")
    save(fig, "unit-economics")


def revenue_model():
    fig, ax = plt.subplots(figsize=(9, 5))
    fig.subplots_adjust(left=0.09, right=0.95, top=0.88, bottom=0.25)
    ax.bar(YEARS, REVENUE_BASE, color="#c9d6e3", label="Base-case revenue in the year")
    styles = {"Upside": (ACCENT, "--"), "Base": (INK, "-"), "Downside": (ACCENT2, ":")}
    for case, (col, ls) in styles.items():
        ax.plot(YEARS, ARR[case], color=col, ls=ls, lw=2, marker="o", label=f"{case}: year-end ARR")
        ax.text(6.15, ARR[case][-1], f"${ARR[case][-1]:.1f}M", va="center", fontsize=9, color=col)
    ax.set_ylabel("US$ millions")
    ax.set_xlim(-0.5, 6.9)
    ax.yaxis.grid(True, color=GRID)
    ax.set_axisbelow(True)
    ax.legend(frameon=False, loc="upper left")
    ax.set_title("Seven-year plan in three cases", loc="left", fontsize=12, color=INK)
    footer(fig, "A plan, not a forecast: there are no customers yet. Base case: $7.3M revenue and "
                "$9.0M ARR in year 5, $18.6M ARR in year 7. Downside: $3.0M ARR in year 5.",
           "scoup-financial-model.xlsx, Base/Upside/Downside rows 14 and 22 "
           "(recalculated 2026-10-22).")
    save(fig, "revenue-model")


if __name__ == "__main__":
    market_size()
    funnel()
    pipeline()
    unit_economics()
    revenue_model()
    print("figures written to", OUT)