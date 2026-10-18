"""Verify model.xlsx is formula-driven and internally consistent.

1. Structural: no numeric constants outside Assumptions; balance sheet, scenario-engine and budget checks are zero.
2. Formula-drivenness: change one assumption at a time, rebuild, recompute, confirm the P&L moves.
3. Scenario and stress runs used in the markdown documents.
Writes tools/verify_results.json.  Run: financial/.venv/Scripts/python.exe financial/tools/verify_model.py
"""
import json, os, subprocess, sys, tempfile
import openpyxl
sys.path.insert(0, os.path.dirname(__file__))
from evalx import evaluate

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
PY = sys.executable; BUILD = os.path.join(HERE, "build_model.py"); MODEL = os.path.join(ROOT, "model.xlsx")
COLS = "BCDEFGH"

def build(overrides=None):
    if not overrides: return MODEL
    d = tempfile.mkdtemp(); o = os.path.join(d, "ovr.json"); out = os.path.join(d, "m.xlsx")
    json.dump(overrides, open(o, "w")); subprocess.run([PY, BUILD, out, o], check=True, capture_output=True)
    return out

def rows(): return json.load(open(os.path.join(HERE, "rowmap.json")))["rows"]

def get(v, sheet, key, cols=COLS):
    r = rows()[f"{sheet}|{key}"]
    out = [v.get((sheet.upper(), f"{c}{r}")) for c in cols]
    return [round(x, 3) if isinstance(x, float) else x for x in out]

res = {}
# ---- 1. structural scan of the baseline file
wb = openpyxl.load_workbook(MODEL)
const, forms = {}, {}
for ws in wb.worksheets:
    if ws.title == "Assumptions": continue
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value, (int, float)) and not isinstance(c.value, bool): const.setdefault(ws.title, []).append(c.coordinate)
            elif isinstance(c.value, str) and c.value.startswith("="): forms[ws.title] = forms.get(ws.title, 0) + 1
res["numeric_constants_outside_assumptions"] = const
res["formula_cells_by_tab"] = forms
build()  # regenerate rowmap for baseline
base = evaluate(MODEL)
checks = {"balance_sheet": get(base, "Balance Sheet", "chk"), "y1_budget_vs_annual": get(base, "OpEx", "qd_chk", "B")}
for k in ["rev", "ebitda", "ni", "fcf", "cash"]: checks["scenario_engine_" + k] = get(base, "Scenarios", "chk_" + k)
res["checks"] = checks
res["checks_pass"] = all(abs(x) < 1e-6 for v in checks.values() for x in v if isinstance(x, (int, float)))

def summary(v):
    s = {}
    for sh, ks in {"Revenue": ["new", "end", "rpa", "rev", "arr", "nrr", "custrec", "sam_rev", "new_shp", "new_imp", "new_car", "end_shp", "end_imp", "end_car", "rpa_shp", "rpa_imp", "rpa_car", "rev_shp", "rev_imp", "rev_car", "arr_shp", "arr_imp", "arr_car"], "Headcount": ["n_tot", "c_tot"],
                   "OpEx": ["o_partner"], "P&L": ["rev", "cogs", "gp", "gm", "o_Engineering", "o_Security", "o_Sales", "o_Marketing", "o_G&A", "opex", "ebitda", "ebitda_m", "da", "tax", "ni"],
                   "Cash Flow": ["cfo", "capex", "fcf", "cff", "close", "burn", "cumfcf"],
                   "Balance Sheet": ["cash", "ar", "ppe", "ta", "ap", "paid", "re", "te"],
                   "Unit Economics": ["new", "sm", "rpa", "car_cac", "car_rpa", "car_ltv", "cac", "gpa", "ltv", "ltvcac", "pay", "nrr", "smr", "cac_b", "ltvcac_b", "pay_b", "cac_p", "ltvcac_p", "pay_p"]}.items():
        for k in ks: s[f"{sh}|{k}"] = get(v, sh, k)
    for k in ["mile", "sam_share"]: s["Revenue|" + k] = get(v, "Revenue", k, "B")[0]
    for k in ["need_seed", "need_total", "mincash", "runway", "y1burn", "u_Engineering", "u_Security", "u_Sales", "u_Marketing", "u_G&A", "u_cogs", "u_capex", "u_wc", "u_tax", "u_gross", "u_rev", "u_net", "u_seed", "u_res", "own"]:
        s["Cash Flow|" + k] = get(v, "Cash Flow", k, "B")[0]
    for d in ["Engineering", "Security", "Sales", "Marketing", "G&A", "Claims operations (COGS)"]:
        s["OpEx|qd_" + d] = get(v, "OpEx", "qd_" + d, "BCDEF")
        s["Headcount|hd_" + d] = get(v, "Headcount", "hd_" + d)
    s["OpEx|qd_tot"] = get(v, "OpEx", "qd_tot", "BCDEF")
    for sc in ["Base", "Bull", "Bear"]:
        for k in ["end", "rev", "arr", "gm", "ebitda", "ni", "fcf", "cash", "hc"]: s[f"Scenarios|{sc}_{k}"] = get(v, "Scenarios", f"{sc}_{k}")
        for k in ["mincash", "need", "seedneed", "mile", "runway"]: s[f"Scenarios|{sc}_{k}"] = get(v, "Scenarios", f"{sc}_{k}", "B")[0]
    return s

res["base"] = summary(base)
for sel, name in [(2, "bull"), (3, "bear")]:
    res[name] = summary(evaluate(build({"sel": sel})))
build()

# ---- 2. formula-drivenness: one assumption at a time
tests = [("share", [0.25, 0.17, 0.20, 0.12, 0.12, 0.12, 0.12], "Recovery share Y3 14% -> 20%"),
         ("infl", 0.06, "Compensation inflation 4% -> 6%"),
         ("fx", 10.5, "NOK per USD 9.3817 -> 10.5")]
res["drivenness"] = []
for key, val, label in tests:
    v = evaluate(build({key: val}))
    before = {k: get(base, "P&L", k) for k in ["rev", "ebitda", "ni"]}
    after = {k: get(v, "P&L", k) for k in ["rev", "ebitda", "ni"]}
    changed = [k for k in before if before[k] != after[k]]
    res["drivenness"].append({"change": label, "before": before, "after": after, "pnl_rows_changed": changed,
                              "bs_check_after": get(v, "Balance Sheet", "chk")})
build()

# ---- 3. stress runs on the base case
stress = {"accounts_minus20": {"new_Base": [round(x * 0.8) for x in [6, 30, 75, 120, 165, 200, 235]]},
          "revenue_per_account_minus20": {"rmult": [0.8]},
          "sm_at_benchmark": {"o_mkt": [round(m + max(0, 2.0 * n * r - sm), 1) for m, n, r, sm in zip(
              [30, 90, 200, 320, 420, 480, 520], res["base"]["Unit Economics|new"], res["base"]["Unit Economics|rpa"], res["base"]["Unit Economics|cac"] and
              [c * n for c, n in zip(res["base"]["Unit Economics|cac"], res["base"]["Unit Economics|new"])])]},
          "cac_31k_pessimistic": {"o_mkt": [round(m + max(0, 31 * n - c * n), 1) for m, n, c in zip(
              [30, 90, 200, 320, 420, 480, 520], res["base"]["Unit Economics|new"], res["base"]["Unit Economics|cac"])]},
          "all_carrier": {"new_Base": [0]*7, "car_Base": [a + b for a, b in zip([6, 30, 75, 120, 165, 200, 235], [0, 0, 15, 30, 50, 70, 90])]},
          "no_tranche2_bear": {"sel": 3, "seed2": 0}}
res["stress"] = {}
for name, ovr in stress.items():
    v = evaluate(build(ovr))
    res["stress"][name] = {k: get(v, "Cash Flow", k, "B")[0] for k in ["need_seed", "need_total", "mincash", "runway"]}
    res["stress"][name]["mile"] = get(v, "Revenue", "mile", "B")[0]
    res["stress"][name]["rev"] = get(v, "Revenue", "rev")
    res["stress"][name]["arr_y7"] = get(v, "Revenue", "arr", "H")[0]
    res["stress"][name]["ebitda"] = get(v, "P&L", "ebitda")
    res["stress"][name]["smr_y3"] = get(v, "Unit Economics", "smr", "D")[0]
    res["stress"][name]["ltvcac_y3"] = get(v, "Unit Economics", "ltvcac", "D")[0]
build()
json.dump(res, open(os.path.join(HERE, "verify_results.json"), "w"), indent=1, default=str)
print("constants outside Assumptions:", sum(len(x) for x in const.values()))
print("formula cells:", forms)
print("checks pass:", res["checks_pass"])
for d in res["drivenness"]: print(d["change"], "-> P&L rows changed:", d["pnl_rows_changed"])
