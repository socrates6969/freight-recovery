"""Reproduces the mid-market shipper counts in research/02-industries.md and 05-market-size.md.

Source: U.S. Census Bureau, Statistics of U.S. Businesses 2022, "us_naicssector_large_rcptsize_2022.xlsx"
(firms by enterprise receipts size), https://www2.census.gov/programs-surveys/susb/tables/2022/
Download it to research/data/susb_2022_sector_large_rcptsize.xlsx, then run: py -3.12 research/scripts/susb_shipper_counts.py
"""
import pathlib
import openpyxl

XLSX = pathlib.Path(__file__).resolve().parent.parent / "data" / "susb_2022_sector_large_rcptsize.xlsx"
SECTORS = {"31-33": "Manufacturing", "42": "Wholesale Trade", "44-45": "Retail Trade"}
CLASSES = ["3: 100,000-249,999", "4: 250,000-499,999", "5: 500,000-999,999", "6: 1,000,000-2,499,999"]

rows = list(openpyxl.load_workbook(XLSX, read_only=True).worksheets[0].iter_rows(values_only=True))
firms = {(r[0], r[2]): r[3] for r in rows if r and r[0] in SECTORS}
for band, cls in {"$100M-$1B (5% freight/sales)": CLASSES[:3], "$250M-$2.5B (2% freight/sales)": CLASSES[1:]}.items():
    total = 0
    for code, name in SECTORS.items():
        n = sum(firms[(code, c)] for c in cls)
        total += n
        print(f"{band:32} {name:16} {n:6}")
    print(f"{band:32} {'TOTAL':16} {total:6}")
