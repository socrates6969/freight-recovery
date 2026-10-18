"""Evaluate an xlsx with the `formulas` package and return {(sheet, cell): value}."""
import formulas, numpy as np

def evaluate(path):
    xl = formulas.ExcelModel().loads(path).finish()
    sol = xl.calculate()
    out = {}
    for k, v in sol.items():
        key = k.split("]")[-1].replace("'", "")
        if "!" not in key or ":" in key: continue
        sh, cell = key.split("!")
        try:
            val = v.value[0][0]
        except Exception:
            val = v
        if isinstance(val, np.generic): val = val.item()
        out[(sh.upper(), cell.upper())] = val
    return out
