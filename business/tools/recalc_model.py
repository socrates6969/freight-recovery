"""Recalculate business/investor-pack/scoup-financial-model.xlsx without Excel.

Uses the `formulas` package to evaluate every formula, then recomputes the Financing
sheet (its MATCH(TRUE, INDEX(range>=x,0),0) lookups are not supported by `formulas`)
with the same logic in plain Python. Prints the outputs the investor documents quote.

Run: pip install formulas openpyxl && python business/tools/recalc_model.py
"""
from pathlib import Path

import formulas
import numpy as np

WB = Path(__file__).resolve().parents[1] / "investor-pack" / "scoup-financial-model.xlsx"
CASES = ["BASE", "UPSIDE", "DOWNSIDE"]
COLS = "BCDEFGH"


def evaluate(path):
    sol = formulas.ExcelModel().loads(str(path)).finish().calculate()
    out = {}
    for key, val in sol.items():
        ref = str(key).split("]", 1)[1].replace("'", "")
        try:
            v = np.asarray(val.value).ravel()[0]
            out[ref] = v.item() if hasattr(v, "item") else v
        except Exception:  # empty ranges and errors
            out[ref] = None
    return out


def financing(d, milestone, buffer, close_months, runway):
    rows = {}
    for case in CASES:
        arr = [d[f"{case}!{c}22"] for c in COLS]
        ebitda = [d[f"{case}!{c}20"] for c in COLS]
        months_arr, months_eb = [], []
        for m in range(1, 85):
            y = (m - 1) // 12
            prev = arr[y - 1] if y else 0
            months_arr.append(prev + (arr[y] - prev) * (m - 12 * y) / 12)
            months_eb.append(ebitda[y] / 12)
        hit = next((i + 1 for i, a in enumerate(months_arr) if a >= milestone), None)
        if hit is None:
            rows[case] = ("not reached", None, None)
            continue
        seed = -sum(e for i, e in enumerate(months_eb) if i + 1 <= hit + close_months)
        a_round = -sum(e for i, e in enumerate(months_eb) if hit < i + 1 <= min(84, hit + runway))
        rows[case] = (hit, seed * (1 + buffer), max(0, a_round) * (1 + buffer))
    return rows


def main():
    d = evaluate(WB)
    print("Revenue per account ($K):", [d[f"ASSUMPTIONS!{c}16"] for c in COLS])
    for case in CASES:
        for row, name in [(10, "accounts"), (14, "revenue $M"), (20, "EBITDA $M"),
                          (22, "ARR $M"), (23, "headcount")]:
            vals = [round(d[f"{case}!{c}{row}"], 3) for c in COLS]
            print(f"{case:9s} {name:11s} {vals}")
    for i in range(4, 15):
        print("Unit economics", d.get(f"UNIT ECONOMICS!A{i}"), round(d[f"UNIT ECONOMICS!B{i}"], 3))
    fin = financing(d, d["ASSUMPTIONS!B5"], d["ASSUMPTIONS!B6"], d["ASSUMPTIONS!B7"],
                    d["ASSUMPTIONS!B8"])
    for case, (month, seed, a_round) in fin.items():
        print(f"{case:9s} milestone month {month}; seed need incl. buffer "
              f"{seed and round(seed, 2)}; Series A need incl. buffer {a_round and round(a_round, 2)}")


if __name__ == "__main__":
    main()