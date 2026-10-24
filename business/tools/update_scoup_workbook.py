"""Apply the 2026-10-22 verification pass to
business/investor-pack/scoup-financial-model.xlsx.

Only sourced inputs and source notes change. Every formula is kept. Each change is
printed as cell | old | new | reason, and a "Sources (verified)" sheet maps cells to
source name, URL, publication date and access date.
"""
from pathlib import Path

import openpyxl
from openpyxl.styles import Font

WB = Path(__file__).resolve().parents[1] / "investor-pack" / "scoup-financial-model.xlsx"
ACC = "2026-10-22"

# Descartes Global Shipping Report: US containerized imports, calendar 2025.
US_IMPORT_TEU_2025 = 28_079_201
# FMC: about $15.4B D&D collected by nine carriers, 2020-04-01 to 2025-03-31; 5-year average.
FMC_DD_PER_YEAR = 3_080_000_000

wb = openpyxl.load_workbook(WB)
changes = []


def setv(sheet, ref, new, why):
    cell = wb[sheet][ref]
    old = cell.value
    if old != new:
        cell.value = new
        changes.append((f"{sheet}!{ref}", old, new, why))


# Assumptions: source notes on inputs whose value is kept.
setv("Assumptions", "C5",
     "Carta: median ARR at Series A was $2.8M in 2025, up from $2.3M in 2024 (B, carta.com/data; "
     "accessed 2026-10-22). Input kept at $2.5M as a planning choice (C)",
     "source re-verified; value kept")
setv("Assumptions", "I15",
     "25% in pilots, 12% with the platform fee (C). Published parcel-refund pricing: Refund "
     "Retriever 50%/45%/40% of refunds by volume band (A, refundretriever.com/pricing, "
     "accessed 2026-10-22)",
     "source named and re-verified")

# Customer value: replace the untraceable 25.66M TEU denominator.
setv("Customer value", "B10", f"=ROUND({FMC_DD_PER_YEAR}/{US_IMPORT_TEU_2025}*2000,-3)",
     "was 240000 from an untraceable 25.66M TEU; now FMC $3.08B/yr / 28.08M TEU (Descartes 2025)")
setv("Customer value", "C10",
     "FMC about $15.4B over Apr 2020-Mar 2025 = $3.08B/yr (A) / US container imports 2025 "
     "28,079,201 TEU (Descartes, B) = about $110/TEU (C; rough: FMC covers 9 carriers, imports "
     "and exports)", "denominator sourced")
setv("Customer value", "B11", "=ROUND(B10*0.15,-2)",
     "was hardcoded 36000; now 15% of B10 (share still an assumption)")
setv("Customer value", "C8",
     "$6.86-$11.88 on EIA weekly diesel 2021-2026 (A, our analysis). Latest EIA week "
     "2026-10-19: $6.276/gal (released 2026-10-20)", "latest EIA week added")
setv("Customer value", "C12",
     "145 of 159 in one internal run (158/159 in another record): INTERNAL test on public "
     "tariff names, not customer invoices; not independently reproduced. Do not quote externally",
     "conflicting internal results flagged")

# Competitors: verified figures.
setv("Competitors", "C4",
     "Series B $35M (Oct 2023); Series C $95M (17 Apr 2026, led by Valor Equity Partners); "
     "about $160M total (Sacra estimate)", "Series C date and lead verified on loop.com")
setv("Competitors", "D4", "A (Series C) / C (total)", "grade split")
setv("Competitors", "C7",
     "FY2025 revenue $190.8M; net income $35.1M; transportation dollar volume $36.4B "
     "(8-K, 22 Jan 2026)", "verified on SEC EDGAR")
setv("Competitors", "C9",
     "Series A $25M (Mar 2024); Series B $75M (29 Jul 2026, Battery Ventures and NewRoad); "
     "about $100M total", "verified via Crunchbase News coverage")
setv("Competitors", "C12",
     "Series B $44M (3 Sep 2025, led by Base10); valuation not confirmed", "round verified via Reuters coverage; valuation has no primary source")
setv("Competitors", "D12", "B (round); valuation unconfirmed", "valuation unconfirmed")
setv("Assumptions", "K21", "SSB 2025: information and communication NOK 80,770/month (about NOK 969K/yr) x 1.22 loaded (A/C)", "SSB 2025 verified")
setv("Assumptions", "K22", "SSB 2025 ICT pay, upper range, x 1.22 (A/C)", "SSB 2025 verified")
setv("Assumptions", "K23", "SSB ICT pay x 1.22; BLS May 2025 information security analysts median $129,180 for US comparison (A)", "BLS May 2025 verified")
setv("Assumptions", "K24", "BLS May 2025 technical and scientific sales reps median $104,920; on-target earnings ~2x base, loaded (A/C)", "BLS May 2025 verified")
setv("Assumptions", "K25", "BLS May 2025 sales engineers median $124,900 x 1.43 (A)", "BLS May 2025 verified")
setv("Sources", "A14", "Cass FY2025 results, 8-K exhibit 99.1 (22 Jan 2026)", "figures come from the 8-K, not the 10-K")
setv("Sources", "B14", "https://www.sec.gov/Archives/edgar/data/708781/000070878126000002/cass-20251231xexx991.htm", "8-K URL")

# Financing notes recomputed outside Excel.
setv("Financing", "D13",
     "Recalculated 2026-10-22: base need incl. 20% buffer $7.59M (milestone month 38); the old "
     "note said $7.36M. Downside with hiring freeze $7.6M (not recalculated)",
     "note did not match the formulas")
setv("Financing", "C14", "At $2.5M ARR (base case month 38, recalculated 2026-10-22)",
     "was month ~37")
setv("Financing", "D14",
     "Recalculated base need incl. buffer $5.58M; 20% fewer accounts $8.5M (not recalculated)",
     "was Base need $5.7M")

# Source review sheet.
SR = "Source review 2026-10-19"
setv(SR, "A17", "2026-10-22 update", "new row")
setv(SR, "B17",
     "Sourced inputs re-verified; a Sources (verified) sheet maps cells to source, URL and dates. "
     "Recalculated outside Excel with business/tools/recalc_model.py: base Y5 revenue $7.30M, "
     "Y5 ARR $9.03M, Y7 ARR $18.63M. Customer value B10/B11 now use a sourced TEU denominator. "
     "Assumptions!B14 ($52K in year 1) still rests on the old $36K D&D figure; the sourced figure "
     "gives about $32.9K, so B14 would be about $48.9K. Left for the owner to decide.",
     "new row")
setv(SR, "B5",
     "Recalculated 2026-10-22 with the Python formulas engine (no Excel or LibreOffice on this "
     "machine); Excel recalculates on open. Financing!B4:D8 use MATCH(TRUE,INDEX(...)), which "
     "that engine cannot evaluate; recomputed in business/tools/recalc_model.py instead.",
     "calculation status updated")

# Sources (verified) sheet.
NAME = "Sources (verified)"
if NAME in wb.sheetnames:
    wb.remove(wb[NAME])
s = wb.create_sheet(NAME)
rows = [
    ("Cell(s)", "Figure", "Source", "URL", "Published", "Accessed", "Status"),
    ("Assumptions!B5", "Median ARR at Series A, 2025: $2.8M (2024: $2.3M)", "Carta",
     "https://carta.com/data/newsletter-arr-at-series-a/", "2026", ACC,
     "Secondary: search-indexed Carta page; direct fetch returned 403"),
    ("Assumptions!I15", "Parcel refund audit fee 50/45/40% by volume band", "Refund Retriever pricing",
     "https://www.refundretriever.com/pricing", "live page", ACC, "VERIFIED primary (vendor price)"),
    ("Base/Upside/Downside!I6", "GRR fell from 90% to 88% over three years; NRR 101%",
     "Benchmarkit 2025 SaaS Performance Metrics", "https://www.benchmarkit.ai/2025benchmarks",
     "2025", ACC, "VERIFIED primary"),
    ("Base!I25; Unit economics!B13", "Median New CAC ratio $2.00 per $1 of new ARR (2024)",
     "Benchmarkit 2025 SaaS Performance Metrics", "https://www.benchmarkit.ai/2025benchmarks",
     "2025", ACC, "VERIFIED primary"),
    ("Customer value!B10:C10", "D&D about $15.4B, 9 carriers, Apr 2020-Mar 2025",
     "Federal Maritime Commission", "https://www.fmc.gov/detention-and-demurrage/", "2025", ACC,
     "VERIFIED primary"),
    ("Customer value!B10:C10", "US container imports 2025: 28,079,201 TEU (2024: 28,196,462)",
     "Descartes Global Shipping Report (Jan 2026)",
     "https://www.descartes.com/resources/knowledge-center/descartes-releases-january-global-shipping-report-december-us-0",
     "2026-01", ACC, "VERIFIED secondary (Descartes release via trade press)"),
    ("Customer value!B8:C8", "Diesel $6.276/gal, week of 2026-10-19", "U.S. EIA weekly retail diesel",
     "https://www.eia.gov/dnav/pet/pet_pri_gnd_a_epd2d_pte_dpgal_w.htm", "2026-10-20", ACC,
     "VERIFIED primary"),
    ("Customer value!B4:B7", "Detention in 39.3% of stops; 94.5% of fleets bill; fewer than half of invoices paid; $15.1B",
     "ATRI, Costs and Consequences of Truck Driver Detention",
     "https://truckingresearch.org/2024/09/new-research-documents-substantial-financial-and-safety-impacts-from-truck-driver-detention/",
     "2024-09-10", "2026-10-19", "VERIFIED primary; B4:B7 dollar amounts are our own simulation (C)"),
    ("Customer value!C11", "46 CFR 541.5 and 541.7; 541.4 reserved", "eCFR; Federal Register 2025-23920",
     "https://www.ecfr.gov/current/title-46/chapter-IV/subchapter-B/part-541", "current through 2026-10-15",
     "2026-10-19", "VERIFIED primary in the 2026-10-19 ledger; eCFR blocked our 2026-10-22 fetch"),
    ("Competitors!C4", "Loop Series C $95M, 17 Apr 2026", "Loop",
     "https://www.loop.com/article/loop-raises-95m-series-c-to-scale-its-ai-platform-across-the-supply-chain",
     "2026-04-17", ACC, "VERIFIED primary"),
    ("Competitors!C7", "Cass FY2025 revenue $190.8M, net income $35.1M, $36.4B volume",
     "Cass 8-K exhibit 99.1", "https://www.sec.gov/Archives/edgar/data/708781/000070878126000002/cass-20251231xexx991.htm",
     "2026-01-22", ACC, "VERIFIED primary"),
    ("Competitors!C9", "Freehand Series B $75M; about $100M raised", "Crunchbase News",
     "https://news.crunchbase.com/transportation/freehand-pando-enterprise-supply-chain-spend-management-startup/",
     "2026-07-29", ACC, "VERIFIED secondary"),
    ("Competitors!C12", "HappyRobot Series B $44M (3 Sep 2025, Base10); valuation NOT confirmed", "Reuters via Inc.",
     "https://www.inc.com/reuters/happyrobot-raises-44-million-to-expand-ai-agents/91234965",
     "2025-09-03", ACC, "Round verified, secondary; valuation unconfirmed"),
    ("Competitors!C5", "Intelligent Audit: subscription pricing; Catalyst 90-day trial", "Intelligent Audit FAQ",
     "https://www.intelligentaudit.com/faq", "live page", ACC, "VERIFIED primary"),
    ("(docs only)", "US logistics costs 2025 $2.40T (7.8% of GDP); trucking 36.8% of logistics spend",
     "CSCMP/Kearney State of Logistics 2026, via SCDigest",
     "https://www.scdigest.com/firstthoughts/26-06-26.php?cid=23144", "2026-06-26", ACC,
     "VERIFIED secondary"),
    ("(docs only)", "Shipper must contest a bill within 180 days of receipt", "49 U.S.C. 13710(a)(3)(B)",
     "https://www.law.cornell.edu/uscode/text/49/13710", "current", ACC, "VERIFIED primary"),
    ("(docs only)", "18 months for charges/overcharges (a)-(b); +6 months after written disallowance (d)", "49 U.S.C. 14705(a), (b), (d)",
     "https://www.law.cornell.edu/uscode/text/49/14705", "current", ACC, "VERIFIED primary"),
    ("(docs only)", "Failure to include required D&D invoice information eliminates the obligation to pay", "46 U.S.C. 41104(d)(2), (f)",
     "https://www.govinfo.gov/app/details/USCODE-2023-title46", "2022 (OSRA)", ACC, "VERIFIED primary"),
    ("Assumptions!K21:K28", "SSB 2025 ICT NOK 80,770/month; BLS May 2025 medians; employer tax 14.1%", "SSB; BLS Occupational Outlook Handbook; Skatteetaten",
     "https://www.ssb.no/arbeid-og-lonn/lonn-og-arbeidskraftkostnader/statistikk/lonn", "various", ACC,
     "VERIFIED primary; multipliers 1.22 / 1.43 remain assumptions"),
    ("Assumptions!K33", "SOC 2 Type II $50-110K; pen test $15-35K", "vendor ranges", "-", "-", ACC,
     "NOT verified; assumption (C)"),
    ("Competitors!C6, C10, C11, C13, C14", "Trax, Terminal49, Vizion, Freightos, Transporeon",
     "various", "-", "-", ACC, "NOT re-verified this pass; existing grades kept"),
]
for r in rows:
    s.append(r)
for c in s[1]:
    c.font = Font(bold=True)
for col, w in zip("ABCDEFG", (30, 52, 36, 70, 14, 12, 46)):
    s.column_dimensions[col].width = w

wb.save(WB)
for c in changes:
    print(*c, sep=" | ")