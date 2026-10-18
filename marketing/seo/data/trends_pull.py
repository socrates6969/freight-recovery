"""Pull Google Trends relative interest (US, 2021-10-01..2026-09-30) for the keyword batches below.

Google Trends values are RELATIVE (0-100, scaled to the peak of the terms in one request), not
search volumes. Every batch contains the anchor term "freight audit" so batches can be compared
through it. Run: python trends_pull.py [BATCH ...]  (needs `pip install pytrends`). Output: trends_*.csv.
"""
import csv, sys, time
from pathlib import Path
from pytrends.request import TrendReq

OUT = Path(__file__).parent
GEO, TIMEFRAME, ANCHOR = "US", "2021-10-01 2026-09-30", "freight audit"
BATCHES = {
    "A_core":      ["detention pay", "detention time", "freight claim", "accessorial charges"],
    "B_audit":     ["freight audit software", "freight bill audit", "freight invoice audit", "freight payment"],
    "C_accessorial": ["lumper fee", "tonu", "layover pay", "detention charges"],
    "D_ocean":     ["demurrage", "demurrage and detention", "detention trucking", "accessorial fees"],
    "E_dispute":   ["freight dispute", "rate confirmation", "detention fee", "freight overcharge"],
    # Added 2026-10-17 after the owner's shipper/importer-first decision.
    "F_importer":  ["demurrage charges", "container detention", "per diem charges", "fmc demurrage"],
    "G_shipper":   ["freight invoice", "accessorial", "lumper", "freight bill"],
}

p = TrendReq(hl="en-US", tz=0)
summary = []
ONLY = set(sys.argv[1:])  # optional: batch names to (re)pull; summary then covers only those batches
for name, terms in BATCHES.items():
    if ONLY and name not in ONLY:
        continue
    kw = [ANCHOR] + terms
    p.build_payload(kw, geo=GEO, timeframe=TIMEFRAME)
    df = p.interest_over_time().drop(columns=["isPartial"])
    df.to_csv(OUT / f"trends_{name}.csv")
    means = df.mean()
    for k in kw:
        summary.append({"batch": name, "term": k, "mean_interest": round(float(means[k]), 1),
                        "ratio_to_anchor": round(float(means[k] / means[ANCHOR]), 2) if means[ANCHOR] else ""})
    time.sleep(8)
summary_file = OUT / ("trends_summary.csv" if not ONLY else f"trends_summary_{'_'.join(sorted(ONLY))}.csv")
with open(summary_file, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["batch", "term", "mean_interest", "ratio_to_anchor"])
    w.writeheader(); w.writerows(summary)
for r in summary: print(r)
