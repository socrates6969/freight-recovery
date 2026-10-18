"""Google Trends 'related queries' (top + rising), US, 2021-10-01..2026-09-30, for seed terms.
Values are Trends' own relative scores, not volumes. Output: trends_related.csv. Needs pytrends."""
import csv, time
from pathlib import Path
from pytrends.request import TrendReq
SEEDS = ["freight audit", "detention pay", "demurrage", "freight claim", "rate confirmation"]
p = TrendReq(hl="en-US", tz=0)
rows = []
for s in SEEDS:
    p.build_payload([s], geo="US", timeframe="2021-10-01 2026-09-30")
    rq = p.related_queries().get(s, {}) or {}
    for kind in ("top", "rising"):
        df = rq.get(kind)
        if df is None: continue
        for _, r in df.head(15).iterrows():
            rows.append({"seed": s, "type": kind, "query": r["query"], "value": r["value"]})
    time.sleep(8)
with open(Path(__file__).parent / "trends_related.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["seed", "type", "query", "value"]); w.writeheader(); w.writerows(rows)
for r in rows: print(r)
