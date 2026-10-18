"""Build financial/model.xlsx for scoup.ai. Every cell outside the Assumptions tab is a formula.

Run:  financial/.venv/Scripts/python.exe financial/tools/build_model.py [output.xlsx] [overrides.json]
Inputs live in the tables below; each carries a status (SOURCED / ASSUMED / PENDING research / DERIVED)
and a source or reasoning string, written into Assumptions columns I and J.
overrides.json (optional) maps an input key to a new value, used by verify_model.py.
"""
import json, os, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter as L

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "model.xlsx")
OVR = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else {}
YRS = list(range(1, 8))
YC = [L(c) for c in range(2, 9)]          # B..H = Y1..Y7
BLUE = Font(color="0000CC"); BOLD = Font(bold=True); HDR = Font(bold=True, color="FFFFFF")
FILL = PatternFill("solid", fgColor="1F3A5F"); SEC = PatternFill("solid", fgColor="DDE6F0")
SCEN = ["Base", "Bull", "Bear"]
K = '#,##0;[Red]-#,##0'; K1 = '#,##0.0;[Red]-#,##0.0'; P = '0.0%'; X = '0.00"x"'; N = '0'

wb = Workbook()
sheets = {}
for n in ["Assumptions", "Revenue", "Headcount", "OpEx", "P&L", "Cash Flow", "Balance Sheet", "Unit Economics", "Scenarios"]:
    sheets[n] = wb.create_sheet(n)
del wb["Sheet"]
R = {}
ROW = {n: 1 for n in sheets}
INPUT_LOG = []   # for assumptions.md

def q(sheet):
    return "'" + sheet + "'" if (" " in sheet or "&" in sheet) else sheet

def ref(sheet, key, col, here=None, abs_=False):
    r = R[(sheet, key)]
    cell = f"${col}${r}" if abs_ else f"{col}{r}"
    return cell if sheet == here else f"{q(sheet)}!{cell}"

def put(sheet, key, label, vals=None, fmt=None, inp=False, status="", src="", bold=False, cols=None):
    ws = sheets[sheet]; r = ROW[sheet]; ROW[sheet] += 1
    if key: R[(sheet, key)] = r
    ws.cell(r, 1, label).font = BOLD if bold else Font()
    if vals is not None:
        if inp and key in OVR:
            o = OVR[key] if isinstance(OVR[key], list) else [OVR[key]]
            vals = list(o) + list(vals[len(o):])
        cols = cols or YC[:len(vals)]
        for c, v in zip(cols, vals):
            if v is None: continue
            cell = ws[f"{c}{r}"]; cell.value = v
            if inp and not (isinstance(v, str) and v.startswith("=")): cell.font = BLUE
            if fmt: cell.number_format = fmt
    if status: ws.cell(r, 9, status)
    if src: ws.cell(r, 10, src)
    if sheet == "Assumptions" and status and status not in ("DERIVED", "STRUCTURAL", "CONTROL"):
        INPUT_LOG.append((key, label, [v for v in (vals or []) if not isinstance(v, str)], status, src))
    return r

def section(sheet, title, heads=None):
    ws = sheets[sheet]; r = ROW[sheet]; ROW[sheet] += 1
    ws.cell(r, 1, title).font = BOLD
    for c in range(1, 11): ws.cell(r, c).fill = SEC
    if heads:
        for i, h in enumerate(heads): ws.cell(r, 2 + i, h).font = BOLD

def blank(sheet): ROW[sheet] += 1
def prev(c): return YC[YC.index(c) - 1]

# ================================================================ Assumptions
A = "Assumptions"; wa = sheets[A]
wa["A1"] = "scoup.ai financial model: Assumptions (all inputs; blue = editable input)"; wa["A1"].font = Font(bold=True, size=13)
wa["A2"] = ("Pre-product, pre-revenue, no customers, synthetic data only. Every figure is a plan input or its arithmetic "
            "consequence, not a forecast. $K unless stated. Year 1 = first 12 months after seed close.")
ROW[A] = 4
for i, h in enumerate(["Input", "Value / Y1", "Y2 / Bull", "Y3 / Bear", "Y4 / Live", "Y5", "Y6", "Y7", "Status", "Source / reasoning"]):
    c = wa.cell(3, 1 + i, h); c.font = HDR; c.fill = FILL

section(A, "Scenario control")
put(A, "sel", "Active scenario (1 = Base, 2 = Bull, 3 = Bear)", [1], N, True, "CONTROL", "Drives every main tab. The Scenarios tab computes all three side by side regardless.")
put(A, "yr", "Year index", YRS, N, True, "STRUCTURAL", "Used by formulas that depend on the year number.")

section(A, "Global inputs (same in every scenario)")
G = [
 ("infl", "Compensation inflation per year", 0.04, P, "ASSUMED", "Planning assumption carried from the investor-pack workbook (grade C)."),
 ("fx", "NOK per USD", 9.3817, '0.0000', "SOURCED", "Norges Bank, USD/NOK monthly average Sep 2026 = 9.3817, https://data.norges-bank.no/api/data/EXR/M.USD.NOK.SP, accessed 2026-10-17. Replaces 10.5 in the prior workbook."),
 ("no_load", "Norway loading on gross salary (employer tax + pension + other)", 1.22, '0.00', "ASSUMED", "Employer tax zone I 14.1% is SOURCED (Skatteetaten, https://www.skatteetaten.no/satser/arbeidsgiveravgift/, accessed 2026-10-17); the remaining ~8 points (mandatory pension, insurance) are assumed."),
 ("us_ben", "US benefits share of total compensation", 0.30, P, "SOURCED", "BLS Employer Costs for Employee Compensation, June 2026: benefits 30.0% of private-industry compensation, https://www.bls.gov/news.release/ecec.nr0.htm, accessed 2026-10-17. Loaded cost = wage / (1 - 0.30)."),
 ("tax", "Norwegian corporate income tax rate", 0.22, P, "SOURCED", "22% (DLA Piper Global Expansion Tax, Norway, https://intelligence.dlapiper.com/global-expansion-tax/?c=NO, accessed 2026-10-17). Unlimited loss carry-forward assumed; confirm with counsel."),
 ("dso", "Days sales outstanding", 60, N, "ASSUMED", "Contingency fees are invoiced after the counterparty pays the customer; 60 days assumed. Unmeasured."),
 ("dpo", "Days payable outstanding (non-payroll costs)", 30, N, "ASSUMED", "Standard 30-day vendor terms assumed."),
 ("capex", "Equipment capex per net new hire ($K)", 3, K, "ASSUMED", "Laptop and peripherals. Software development is expensed, not capitalised."),
 ("dep", "Depreciation life (years)", 3, N, "ASSUMED", "Straight line."),
 ("int", "Interest earned on cash", 0.0, P, "ASSUMED", "Set to zero for conservatism."),
 ("cash0", "Opening cash at seed close, before seed ($K)", 0, K, "ASSUMED", "UNKNOWN; owner to confirm founder-funded cash and share capital (NOK 30,000 minimum for an AS)."),
]
for k, lab, v, f, st, s in G:
    put(A, k, lab, [v], f, True, st, s)
G2 = [
 ("milestone", "Series A ARR milestone ($K)", 2500, K, "ASSUMED", "Planning target. Reference: median ARR at Series A $2.8M in 2025 (Carta, ARR at Series A, https://carta.com/data/newsletter-arr-at-series-a/, figure confirmed via search result 2026-10-17; direct fetch returned HTTP 403)."),
 ("buffer", "Cash buffer on each round", 0.20, P, "ASSUMED", "Planning assumption carried from the investor-pack workbook."),
 ("seed1", "Seed tranche 1 ($K)", 4000, K, "ASSUMED", "Plan decision; sized against the Cash Flow funding-need rows."),
 ("seed1y", "Seed tranche 1 year", 1, N, "ASSUMED", "At close."),
 ("seed2", "Seed tranche 2 ($K)", 3000, K, "ASSUMED", "Released at milestone: 5 paying customers, recovery measured on real invoices, ARR above $0.5M."),
 ("seed2y", "Seed tranche 2 year", 2, N, "ASSUMED", "Base case passes $0.5M ARR in year 2."),
 ("seriesA", "Series A ($K)", 8500, K, "ASSUMED", "Plan decision, kept from the investor-pack plan; tested against all three scenarios."),
 ("seriesAy", "Series A year", 4, N, "ASSUMED", "Base case crosses the ARR milestone early in year 4."),
 ("pre", "Seed pre-money valuation ($K)", 18400, K, "ASSUMED", "Orientation only: median US seed pre-money $18.4M in Q1 2026 (PitchBook via WaveUp, grade C, not re-verified). Terms are set with the lead investor."),
 ("bench_sm", "Benchmark: S&M spend per $1 of new ARR", 2.00, '0.00', "SOURCED", "Benchmarkit 2025 SaaS Performance Metrics (2024 data), median New CAC Ratio $2.00, https://www.benchmarkit.ai/2025benchmarks, accessed 2026-10-17."),
 ("bench_grr", "Benchmark: median gross revenue retention", 0.88, P, "SOURCED", "Benchmarkit 2025 report: GRR 88%, same URL, accessed 2026-10-17."),
 ("bench_nrr", "Benchmark: median net revenue retention", 1.01, P, "SOURCED", "Benchmarkit 2025 report: NRR 101%, same URL, accessed 2026-10-17."),
 ("sam", "SAM: addressable shipper + importer accounts (count)", 32765, K, "SOURCED", "market-researcher research/05-market-size.md v3 (2026-10-17): 19,932 mid-market shippers (Census SUSB 2022 firms with $100M-$999.9M receipts in manufacturing, wholesale and retail, i.e. $5M-$50M freight spend at 4.68% transport-to-sales, Establish via DC Velocity 2008, grade B) + SME importers capped at 12,833 (FMC D&D pool $3.08B / $240K exposure). TAM adds carriers 72,053 and brokers 28,438 = 133,256 accounts."),
 ("sam_usd", "SAM: annual revenue pool, shipper + importer accounts ($K)", 945400, K, "SOURCED", "market-researcher research/05-market-size.md v3: final figure at our year-7 segment rates: shippers 19,932 x $27.6K = $550.1M + importers 12,833 x $30.8K = $395.3M = $945.4M; range $0.61B-$1.01B because the shipper/importer overlap is unknown. TAM $1,855.5M (133,256 accounts: SAM + 72,053 carriers x $7,895 + 28,438 brokers x $12K, broker rate assumed). Replaces the flat-rate $1,009.2M SAM / $4.10B TAM. Supersedes the withdrawn v2 figures ($474.2M SAM, $10.30B TAM, $8.99B SAM)."),
 ("pess_cac", "Pessimistic CAC: paid-media cost per small-company customer ($K)", 31, K1, "SOURCED", "Metadata.io, 2026 B2B Paid Media Benchmark Report (2025 data, 153 advertisers): small-company customer cost $31k, https://metadata.io/md/benchmark-report-2026.md, accessed 2026-10-17. Media cost only; excludes sales labour. LinkedIn cost per customer $58,572 (same source, reported by digital-marketing, not re-verified by finance)."),
]
for k, lab, v, f, st, s in G2:
    put(A, k, lab, [v], f, True, st, s)

section(A, "Revenue per account build, base path ($K per account per year)", ["Y1", "Y2", "Y3", "Y4", "Y5", "Y6", "Y7"])
put(A, "fee", "Platform fee", [0, 6, 10, 13, 15, 16, 17], K1, True, "ASSUMED", "Investor-pack workbook (grade C). Hybrid fee starts in year 2. No competitor publishes pricing (market-researcher research/01-competitors.md, 2026-10-17), so there is no market check.")
put(A, "recov", "Amount recovered for the customer", [52, 70, 85, 95, 105, 110, 115], K1, True, "ASSUMED", "Year 1 $52K = business-case base for a mid-size importer-shipper (D&D $36K + fuel surcharge $16K), built on FMC and EIA/ATRI figures; grows as modules are added. Not measured on any customer data.")
put(A, "share", "Recovery share (contingency %)", [0.25, 0.17, 0.14, 0.12, 0.12, 0.12, 0.12], P, True, "ASSUMED", "25% pilot contingency, falling once the platform fee starts. No freight competitor publishes a contingency rate (market-researcher research/01-competitors.md, 2026-10-17). Only public reference: Refund Retriever (parcel audit) 40-50%, https://www.refundretriever.com/pricing, accessed 2026-10-17.")

section(A, "Segments: shippers and SME importers are the core; carriers are a later, partner-led segment")
put(A, "mix_shp", "Shipper share of new shipper + importer accounts", [0.5], P, True, "ASSUMED", "Owner decision 2026-10-17: shipper- and importer-first. 50/50 split assumed; SME importers are counted (234,023, US Census) but mid-market shippers are not yet.")
put(A, "shp_mult", "Shipper amount recovered vs importer path", [0.77], '0.00', True, "ASSUMED", "A domestic mid-market shipper has no ocean D&D. Business-case year-1 example: fuel-surcharge recovery $16K (business case, EIA-based) + accessorial and detention invoice audit $24K (assumed) = $40K vs $52K for an importer = 0.77.")
put(A, "car_rec", "Carrier: amount recovered per carrier ($K/yr)", [39.475] * 7, K1, True, "ASSUMED", "market-researcher research/02 and 05 (2026-10-17): $471.60 fee per power unit x 16.7 units = $7,895 per carrier at a 20% fee, so recovered = $7,895 / 20% = $39.5K. Built on assumed inputs (400 stops per truck, $100 per detained stop, 30% winnable); ATRI 39.3% detention rate sourced.")
put(A, "car_share", "Carrier: contingency share (no platform fee)", [0.20], P, True, "ASSUMED", "Fee used in the research carrier model and in gtm.md.")
put(A, "partner", "Partner commission on carrier revenue (factoring / ELD channel)", [0.20], P, True, "ASSUMED", "Carriers come through a channel partner, not direct sales; commission booked in the Sales department.")

section(A, "Scenario inputs (scalars)", ["Base", "Bull", "Bear", "Live"])
SC = [
 ("churn", "Annual logo churn", [0.20, 0.15, 0.30], P, "ASSUMED", "Share of start-of-year accounts lost in the year. Benchmarkit median GRR 88% implies ~12% revenue churn for SaaS; a contingency service is easy to switch off, so 20% base."),
 ("rmult", "Revenue per account vs base path", [1.00, 1.15, 0.80], '0.00', "ASSUMED", "Bull: larger recoveries and early platform-fee adoption. Bear: recoveries 20% lower."),
 ("scale", "Headcount and spend scale vs base plan", [1.00, 1.10, 0.85], '0.00', "ASSUMED", "Applied to every role except the founder, and to other operating costs from year 2."),
 ("freeze", "Hold headcount and spend at prior-year level from year (0 = never)", [0, 0, 3], N, "ASSUMED", "Bear cost response: if the tranche-2 milestone is missed, hold at year-2 levels (investor-pack financial plan section 4 describes this but the workbook did not model it)."),
 ("fdur", "Number of years the hold lasts", [0, 0, 2], N, "ASSUMED", "Bear: years 3 and 4 held at year-2 levels, then the scaled plan resumes. A permanent hold would leave 2 claims analysts serving 235 accounts, which is not credible."),
 ("varc", "Variable cost of revenue (% of revenue)", [0.08, 0.07, 0.10], P, "ASSUMED", "New input: LLM inference, OCR and per-container event data. Unmeasured; replaces the gross-margin-% input of the prior workbook."),
]
for k, lab, v, f, st, s in SC:
    rr = ROW[A]
    put(A, k, lab, v + [f"=CHOOSE({ref(A,'sel','B',A,True)},B{rr},C{rr},D{rr})"], f, True, st, s, cols=["B", "C", "D", "E"])

section(A, "Scenario inputs (by year): new shipper + importer accounts won, and carrier accounts", ["Y1", "Y2", "Y3", "Y4", "Y5", "Y6", "Y7"])
NA = {"Base": [6, 30, 75, 120, 165, 200, 235], "Bull": [8, 40, 100, 160, 215, 260, 300], "Bear": [4, 16, 35, 55, 75, 90, 105]}
for s in SCEN:
    put(A, "new_" + s, f"New shipper + importer accounts won - {s}", NA[s], N, True, "ASSUMED", "Plan input from the investor-pack workbook (grade C). No pipeline exists yet.")
put(A, "new_live", "New accounts won - Live", [f"=CHOOSE({ref(A,'sel','B',A,True)},{c}{R[(A,'new_Base')]},{c}{R[(A,'new_Bull')]},{c}{R[(A,'new_Bear')]})" for c in YC], N, status="DERIVED")
CA = {"Base": [0, 0, 15, 30, 50, 70, 90], "Bull": [0, 10, 30, 60, 90, 120, 150], "Bear": [0, 0, 0, 0, 10, 20, 30]}
for s_ in SCEN:
    put(A, "car_" + s_, f"New carrier accounts via partner - {s_}", CA[s_], N, True, "ASSUMED", "Small partner-led segment starting later (base: factoring partner from year 3; bull: partner signed in year 2; bear: partner slips to year 5).")
put(A, "car_live", "New carrier accounts via partner - Live", [f"=CHOOSE({ref(A,'sel','B',A,True)},{c}{R[(A,'car_Base')]},{c}{R[(A,'car_Bull')]},{c}{R[(A,'car_Bear')]})" for c in YC], N, status="DERIVED")

ROLES = [  # key, label, location, pay, pay status, pay source, startQ, plan, department, scaled
 ("ceo", "Founder / CEO", "NO", 1200000, "ASSUMED", "NOK pay held below market until Series A; equals the $140K loaded in the prior workbook at 10.5 NOK/USD.", 1, [1]*7, "G&A", False),
 ("swe", "Software engineers", "NO", 969240, "SOURCED", "SSB average monthly earnings, information and communication, Nov 2025: NOK 80,770 x 12, https://www.ssb.no/arbeid-og-lonn/lonn-og-arbeidskraftkostnader/statistikk/lonn, accessed 2026-10-17.", 2, [2, 3, 5, 8, 10, 12, 13], "Engineering", True),
 ("ml", "ML / data engineers", "NO", 1060000, "ASSUMED", "SSB sector average plus ~9% for specialist skills (ratio kept from the prior workbook).", 3, [1, 1, 2, 3, 3, 4, 4], "Engineering", True),
 ("sec", "Security engineer", "NO", 1060000, "ASSUMED", "As ML / data engineers.", 2, [1, 1, 1, 2, 2, 3, 3], "Security", True),
 ("ae", "Account executives (US)", "US", 161000, "ASSUMED", "On-target earnings, set so the loaded cost equals the $230K in the prior workbook. Not re-verified.", 1, [0, 1, 3, 5, 7, 8, 9], "Sales", True),
 ("se", "Sales engineer (US)", "US", 124900, "SOURCED", "BLS Occupational Outlook Handbook, sales engineers median $124,900 (May 2025), https://www.bls.gov/ooh/sales/sales-engineers.htm, accessed 2026-10-17.", 1, [0, 1, 1, 2, 2, 3, 3], "Sales", True),
 ("cs", "Claims analysts / customer success (US)", "US", 70000, "ASSUMED", "Analyst base pay ~$70K (prior workbook, grade C).", 3, [1, 2, 4, 7, 10, 13, 16], "Claims operations (COGS)", True),
 ("mkt", "Marketing (US)", "US", 105000, "ASSUMED", "Estimate; loaded $150K as in the prior workbook.", 1, [0, 0, 1, 1, 2, 2, 2], "Marketing", True),
 ("fin", "Finance, legal operations, people", "NO", 1120000, "ASSUMED", "SSB sector average plus ~15%; loaded $130K at 10.5 NOK/USD in the prior workbook.", 1, [0, 1, 1, 2, 2, 3, 3], "G&A", True),
]
section(A, "Headcount plan (people at year end, base scale) and pay", ["Y1", "Y2", "Y3", "Y4", "Y5", "Y6", "Y7"])
for k, lab, loc, sal, st, s, sq, plan, dept, sc in ROLES:
    put(A, "hc_" + k, f"{lab} - headcount plan", plan, N, True, "ASSUMED", f"Department: {dept}. Plan from the investor-pack workbook (grade C).")
    put(A, "sal_" + k, f"{lab} - annual pay ({'NOK' if loc == 'NO' else 'USD'})", [sal], '#,##0', True, st, s)
    put(A, "sq_" + k, f"{lab} - year-1 start quarter (1-4)", [sq], N, True, "ASSUMED", "Hiring quarter for year-1 hires; drives the year-1 quarterly budget.")
    if loc == "NO":
        f = f"=B{R[(A,'sal_'+k)]}*{ref(A,'no_load','B',A,True)}/{ref(A,'fx','B',A,True)}/1000"
    else:
        f = f"=B{R[(A,'sal_'+k)]}/(1-{ref(A,'us_ben','B',A,True)})/1000"
    put(A, "cost_" + k, f"{lab} - loaded cost ($K/yr, year-1 prices)", [f], K1, status="DERIVED", src="NO: pay x loading / FX. US: wage / (1 - benefits share).")

OPX = [
 ("o_host", "Cloud hosting, data feeds and tooling", [45, 80, 140, 220, 300, 370, 430], "COGS", "Terraform footprint plus container-event data fees (prior workbook, grade C)."),
 ("o_sec", "Security programme (SOC 2, pen tests, tooling, insurance)", [120, 150, 170, 190, 210, 230, 250], "Security", "SOC 2 Type II first year $50-110K and pen tests $15-35K each (vendor blogs, grade C, not re-verified)."),
 ("o_legal", "Legal and regulatory", [150, 110, 120, 140, 150, 160, 170], "G&A", "US entity, customer contracts, FMC and data-protection counsel (grade C)."),
 ("o_mkt", "Marketing programmes and events", [30, 90, 200, 320, 420, 480, 520], "Marketing", "Trade shows (TIA, CSCMP, TPM), content, list data (grade C). Channel CAC from digital-marketing pending."),
 ("o_trav", "Travel and customer visits", [60, 100, 150, 200, 240, 270, 300], "Sales", "US customer and partner visits (grade C)."),
 ("o_off", "Office, software, admin, accounting", [50, 80, 110, 150, 180, 210, 240], "G&A", "Estimate (grade C)."),
]
section(A, "Other operating costs, base plan ($K per year)", ["Y1", "Y2", "Y3", "Y4", "Y5", "Y6", "Y7"])
for k, lab, v, line, s in OPX:
    put(A, k, f"{lab} [{line}]", v, K, True, "ASSUMED", s)

wa.column_dimensions["A"].width = 62
for c in "BCDEFGH": wa.column_dimensions[c].width = 11
wa.column_dimensions["I"].width = 17; wa.column_dimensions["J"].width = 120
wa.freeze_panes = "B4"

def a(key, col="B"): return ref(A, key, col, None, True)
def live(key): return ref(A, key, "E", None, True)

def header(sheet, title, note):
    ws = sheets[sheet]
    ws["A1"] = title; ws["A1"].font = Font(bold=True, size=13)
    ws["A2"] = note
    ws["A3"] = "$K unless stated"
    for c in YC: ws[f"{c}3"] = f"=\"Y\"&{a('yr', c)}"
    for c in range(1, 9): ws.cell(3, c).font = HDR; ws.cell(3, c).fill = FILL
    ws.column_dimensions["A"].width = 64
    for c in YC: ws.column_dimensions[c].width = 12
    ws.freeze_panes = "B4"; ROW[sheet] = 4

def yrow(sheet, key, label, fn, fmt=K, bold=False):
    return put(sheet, key, label, [fn(i, c) for i, c in enumerate(YC)], fmt, bold=bold)

def rr(sheet, key, c): return f"{c}{R[(sheet, key)]}"   # same-sheet relative ref

SEGS = [("shp", "Shippers (mid-market)"), ("imp", "SME importers"), ("car", "Carriers (partner-led)")]

def seg_engine(sh, p, new_tot, car_new, churn, rmult, detail=True):
    """Accounts and revenue by segment. new_tot(c)/car_new(c) return refs; churn/rmult are refs."""
    g = lambda k, c: rr(sh, p + k, c)
    newf = {"shp": lambda c: f"ROUND({new_tot(c)}*{a('mix_shp')},0)",
            "imp": lambda c: f"{new_tot(c)}-ROUND({new_tot(c)}*{a('mix_shp')},0)",
            "car": lambda c: car_new(c)}
    rpaf = {"imp": lambda c: f"({a('fee', c)}+{a('recov', c)}*{a('share', c)})*{rmult}",
            "shp": lambda c: f"({a('fee', c)}+{a('recov', c)}*{a('shp_mult')}*{a('share', c)})*{rmult}",
            "car": lambda c: f"{a('car_rec', c)}*{a('car_share')}*{rmult}"}
    for k, lab in SEGS:
        yrow(sh, p+"new_"+k, f"{lab}: new accounts", lambda i, c, k=k: "=" + newf[k](c), N)
        er = ROW[sh] + 1
        yrow(sh, p+"lost_"+k, f"{lab}: accounts lost = ROUND(prior year-end x churn)", lambda i, c, k=k, er=er: "=0" if i == 0 else f"=ROUND({prev(c)}{er}*{churn},0)", N)
        yrow(sh, p+"end_"+k, f"{lab}: accounts at year end", lambda i, c, k=k, er=er: f"={g('new_'+k,c)}" if i == 0 else f"={prev(c)}{er}-{g('lost_'+k,c)}+{g('new_'+k,c)}", N, True)
        yrow(sh, p+"avg_"+k, f"{lab}: average accounts", lambda i, c, k=k: f"={g('end_'+k,c)}/2" if i == 0 else f"=({g('end_'+k,prev(c))}+{g('end_'+k,c)})/2", K1)
        yrow(sh, p+"rpa_"+k, f"{lab}: revenue per account ($K)", lambda i, c, k=k: "=" + rpaf[k](c), K1)
        yrow(sh, p+"rev_"+k, f"{lab}: revenue", lambda i, c, k=k: f"={g('avg_'+k,c)}*{g('rpa_'+k,c)}")
        yrow(sh, p+"arr_"+k, f"{lab}: ARR at year end", lambda i, c, k=k: f"={g('end_'+k,c)}*{g('rpa_'+k,c)}")
    tot = lambda key: (lambda i, c: "=" + "+".join(g(key + "_" + k, c) for k, _ in SEGS))
    yrow(sh, p+"new", "All segments: new accounts won", tot("new"), N, True)
    yrow(sh, p+"lost", "All segments: accounts lost", tot("lost"), N)
    yrow(sh, p+"end", "All segments: paying accounts at year end", tot("end"), N, True)
    yrow(sh, p+"avg", "All segments: average paying accounts", tot("avg"), K1)
    yrow(sh, p+"rev", "Total revenue", tot("rev"), K, True)
    yrow(sh, p+"arr", "ARR at year end", tot("arr"), K, True)
    yrow(sh, p+"rpa", "Blended revenue per account = ARR / accounts ($K)", lambda i, c: f"=IF({g('end',c)}=0,0,{g('arr',c)}/{g('end',c)})", K1, True)
    if detail:
        yrow(sh, p+"rev_fee", "Platform-fee revenue (shippers and importers)", lambda i, c: f"=({g('avg_shp',c)}+{g('avg_imp',c)})*{a('fee', c)}*{rmult}")
        yrow(sh, p+"rev_shr", "Recovery-share revenue", lambda i, c: f"={g('rev',c)}-{g('rev_fee',c)}")
        yrow(sh, p+"custrec", "Total recovered for customers", lambda i, c: f"=({g('avg_imp',c)}*{a('recov', c)}+{g('avg_shp',c)}*{a('recov', c)}*{a('shp_mult')}+{g('avg_car',c)}*{a('car_rec', c)})*{rmult}")
        yrow(sh, p+"nrr", "Net revenue retention = sum over segments of (start accounts - lost) x revenue per account / start ARR", lambda i, c: '=""' if i == 0 else "=IF(" + g('arr', prev(c)) + "=0,\"\",(" + "+".join(f"({g('end_'+k,prev(c))}-{g('lost_'+k,c)})*{g('rpa_'+k,c)}" for k, _ in SEGS) + f")/{g('arr',prev(c))})", P)

# ================================================================ Revenue
S = "Revenue"
header(S, "Revenue build (active scenario)", "Accounts x revenue per account. Revenue per account = (platform fee + amount recovered x recovery share) x scenario multiplier.")
section(S, "Accounts and revenue by segment ($K)")
seg_engine(S, "", lambda c: a('new_live', c), lambda c: a('car_live', c), live('churn'), live('rmult'))
yrow(S, "growth", "Revenue growth", lambda i, c: '=""' if i == 0 else f"=IF({rr(S,'rev',prev(c))}=0,\"\",{rr(S,'rev',c)}/{rr(S,'rev',prev(c))}-1)", P)
M = a('milestone')
yrow(S, "mile_m", "Month ARR crosses the Series A milestone (linear within year)", lambda i, c:
     f"=IF({rr(S,'arr',c)}>={M},12*{M}/{rr(S,'arr',c)},\"\")" if i == 0 else
     f"=IF(AND({rr(S,'arr',c)}>={M},{rr(S,'arr',prev(c))}<{M}),12*({a('yr', c)}-1)+12*({M}-{rr(S,'arr',prev(c))})/({rr(S,'arr',c)}-{rr(S,'arr',prev(c))}),\"\")", K1)
mm = f"B{R[(S,'mile_m')]}:H{R[(S,'mile_m')]}"
put(S, "mile", "Series A milestone month", [f"=IF(COUNT({mm})=0,\"not reached\",ROUNDUP(SUM({mm}),0))"], N, bold=True)
put(S, "sam_share", "Year-7 shipper + importer accounts as share of SAM accounts", [f"=IFERROR((H{R[(S,'end_shp')]}+H{R[(S,'end_imp')]})/{a('sam')},\"\")"], P)
yrow(S, "sam_rev", "Shipper + importer revenue as share of SAM revenue pool", lambda i, c: f"=IFERROR(({rr(S,'rev_shp',c)}+{rr(S,'rev_imp',c)})/{a('sam_usd')},\"\")", P)

# ================================================================ Headcount
H = "Headcount"
header(H, "Headcount and people cost (active scenario)", "Headcount = ROUND(plan x scale), founder unscaled, held at prior year from the freeze year. Year-1 FTE-years use the hiring quarter; later years average start and end headcount. Cost = FTE-years x loaded cost x (1 + inflation)^(year - 1).")
LAB = {r[0]: r[1] for r in ROLES}; DEP = {r[0]: r[8] for r in ROLES}
section(H, "People at year end")
for k, lab, loc, sal, st, s, sq, plan, dept, scl in ROLES:
    def f(i, c, k=k, scl=scl):
        base = f"ROUND({a('hc_'+k, c)}*{live('scale')},0)" if scl else f"{a('hc_'+k, c)}"
        if i == 0: return f"={base}"
        return f"=IF(AND({live('freeze')}>0,{a('yr', c)}>={live('freeze')},{a('yr', c)}<{live('freeze')}+{live('fdur')}),{prev(c)}{ROW[H]},{base})"
    yrow(H, "n_" + k, f"{lab} [{dept}]", f, N)
yrow(H, "n_tot", "Total headcount at year end", lambda i, c: f"=SUM({rr(H,'n_ceo',c)}:{rr(H,'n_fin',c)})", N, True)
yrow(H, "hires", "Net new hires", lambda i, c: f"={rr(H,'n_tot',c)}" if i == 0 else f"=MAX(0,{rr(H,'n_tot',c)}-{rr(H,'n_tot',prev(c))})", N)
section(H, "FTE-years paid in the year")
for k in LAB:
    yrow(H, "f_" + k, LAB[k], lambda i, c, k=k: f"={rr(H,'n_'+k,c)}*(5-{a('sq_'+k)})/4" if i == 0 else f"=({rr(H,'n_'+k,prev(c))}+{rr(H,'n_'+k,c)})/2", K1)
section(H, "People cost ($K)")
for k in LAB:
    yrow(H, "c_" + k, LAB[k], lambda i, c, k=k: f"={rr(H,'f_'+k,c)}*{a('cost_'+k)}*(1+{a('infl')})^({a('yr', c)}-1)")
yrow(H, "c_tot", "Total people cost", lambda i, c: f"=SUM({rr(H,'c_ceo',c)}:{rr(H,'c_fin',c)})", K, True)
DEPTS = ["Engineering", "Security", "Sales", "Marketing", "G&A", "Claims operations (COGS)"]
section(H, "People cost by department ($K)")
for d in DEPTS:
    ks = [k for k in LAB if DEP[k] == d]
    yrow(H, "d_" + d, d, lambda i, c, ks=ks: "=" + "+".join(rr(H, 'c_' + k, c) for k in ks))
section(H, "Headcount by department at year end")
for d in DEPTS:
    ks = [k for k in LAB if DEP[k] == d]
    yrow(H, "hd_" + d, d, lambda i, c, ks=ks: "=" + "+".join(rr(H, 'n_' + k, c) for k in ks), N)

# ================================================================ OpEx
O = "OpEx"
header(O, "Operating costs (active scenario)", "Other costs = base plan (year 1) and base plan x scale (year 2 on), held at prior year from the freeze year. Departments combine people cost and programme spend.")
section(O, "Other operating costs ($K)")
for k, lab, v, line, s in OPX:
    yrow(O, k, f"{lab} [{line}]", lambda i, c, k=k: f"={a(k, c)}" if i == 0 else f"=IF(AND({live('freeze')}>0,{a('yr', c)}>={live('freeze')},{a('yr', c)}<{live('freeze')}+{live('fdur')}),{prev(c)}{ROW[O]},{a(k, c)}*{live('scale')})")
yrow(O, "o_partner", "Partner commission on carrier revenue [Sales]", lambda i, c: f"={ref(S,'rev_car',c)}*{a('partner')}")
section(O, "Operating expense by department, excluding cost of revenue ($K)")
DMAP = {"Engineering": [], "Security": ["o_sec"], "Sales": ["o_trav", "o_partner"], "Marketing": ["o_mkt"], "G&A": ["o_legal", "o_off"]}
for d, oks in DMAP.items():
    yrow(O, "dep_" + d, d, lambda i, c, d=d, oks=oks: "=" + "+".join([ref(H, "d_" + d, c)] + [rr(O, k, c) for k in oks]))
yrow(O, "opex", "Total operating expense", lambda i, c: f"=SUM({rr(O,'dep_Engineering',c)}:{rr(O,'dep_G&A',c)})", K, True)
yrow(O, "sm", "Sales and marketing (Sales + Marketing departments)", lambda i, c: f"={rr(O,'dep_Sales',c)}+{rr(O,'dep_Marketing',c)}")
section(O, "Cost of revenue ($K)")
yrow(O, "cogs_ppl", "Claims operations people", lambda i, c: f"={ref(H,'d_Claims operations (COGS)',c)}")
yrow(O, "cogs_host", "Hosting, data feeds and tooling", lambda i, c: f"={rr(O,'o_host',c)}")
yrow(O, "cogs_var", "Variable cost = revenue x variable cost %", lambda i, c: f"={ref(S,'rev',c)}*{live('varc')}")
yrow(O, "cogs", "Total cost of revenue", lambda i, c: f"={rr(O,'cogs_ppl',c)}+{rr(O,'cogs_host',c)}+{rr(O,'cogs_var',c)}", K, True)

blank(O)
QC = ["B", "C", "D", "E"]
section(O, "Year-1 budget by department and quarter ($K). People cost starts in the hiring quarter; non-people costs are spread evenly.", ["Q1", "Q2", "Q3", "Q4", "Year 1"])
for k in LAB:
    vals = [f"={ref(H,'n_'+k,'B')}*IF({qi+1}>={a('sq_'+k)},1,0)*{a('cost_'+k)}/4" for qi in range(4)] + [f"=SUM(B{ROW[O]}:E{ROW[O]})"]
    put(O, "q_" + k, f"{LAB[k]} [{DEP[k]}]", vals, K)
for k, lab, v, line, s in OPX:
    put(O, "q_" + k, f"{lab} [{line}]", [f"={rr(O,k,'B')}/4"] * 4 + [f"=SUM(B{ROW[O]}:E{ROW[O]})"], K)
put(O, "q_o_partner", "Partner commission [Sales]", [f"={rr(O,'o_partner','B')}/4"] * 4 + [f"=SUM(B{ROW[O]}:E{ROW[O]})"], K)
put(O, "q_var", "Variable cost of revenue [COGS]", [f"={rr(O,'cogs_var','B')}/4"] * 4 + [f"=SUM(B{ROW[O]}:E{ROW[O]})"], K)
QD = {d: ["q_" + k for k in LAB if DEP[k] == d] for d in DEPTS}
QD["Security"] += ["q_o_sec"]; QD["Sales"] += ["q_o_trav", "q_o_partner"]; QD["Marketing"] += ["q_o_mkt"]
QD["G&A"] += ["q_o_legal", "q_o_off"]; QD["Claims operations (COGS)"] += ["q_o_host", "q_var"]
section(O, "Year-1 budget: department totals ($K)", ["Q1", "Q2", "Q3", "Q4", "Year 1"])
for d in DEPTS:
    put(O, "qd_" + d, d, ["=" + "+".join(rr(O, k, c) for k in QD[d]) for c in QC + ["F"]], K)
put(O, "qd_tot", "Total year-1 spend (operating expense + cost of revenue)", [f"=SUM({c}{R[(O,'qd_Engineering')]}:{c}{R[(O,'qd_Claims operations (COGS)')]})" for c in QC + ["F"]], K, bold=True)
put(O, "qd_chk", "Check: year-1 budget total minus annual model (must be 0)", [f"=ROUND(F{R[(O,'qd_tot')]}-(B{R[(O,'opex')]}+B{R[(O,'cogs')]}),6)"], K)

# ================================================================ P&L
PL = "P&L"
header(PL, "Income statement (active scenario)", "Cost of revenue is built bottom-up (claims staff, hosting and data, variable cost); gross margin is an output.")
yrow(PL, "rev", "Revenue", lambda i, c: f"={ref(S,'rev',c)}", K, True)
yrow(PL, "cogs", "Cost of revenue", lambda i, c: f"={ref(O,'cogs',c)}")
yrow(PL, "gp", "Gross profit", lambda i, c: f"={rr(PL,'rev',c)}-{rr(PL,'cogs',c)}", K, True)
yrow(PL, "gm", "Gross margin", lambda i, c: f"=IF({rr(PL,'rev',c)}=0,0,{rr(PL,'gp',c)}/{rr(PL,'rev',c)})", P)
for d in DMAP:
    yrow(PL, "o_" + d, f"Operating expense: {d}", lambda i, c, d=d: f"={ref(O,'dep_'+d,c)}")
yrow(PL, "opex", "Total operating expense", lambda i, c: f"=SUM({rr(PL,'o_Engineering',c)}:{rr(PL,'o_G&A',c)})", K, True)
yrow(PL, "ebitda", "EBITDA", lambda i, c: f"={rr(PL,'gp',c)}-{rr(PL,'opex',c)}", K, True)
yrow(PL, "ebitda_m", "EBITDA margin", lambda i, c: f"=IF({rr(PL,'rev',c)}=0,0,{rr(PL,'ebitda',c)}/{rr(PL,'rev',c)})", P)
# forward references are written as tokens <<Sheet|key|col>> and resolved after all sheets exist
def fwd(sheet, key, c): return f"<<{sheet}|{key}|{c}>>"
yrs_rng = f"{q(A)}!$B${R[(A, 'yr')]}:$H${R[(A, 'yr')]}"
cap_rng = f"{q(H)}!$B${{CAPROW}}:$H${{CAPROW}}"
yrow(PL, "da", "Depreciation = capex of the last N years / N (N = depreciation life)",
     lambda i, c: f"=SUMPRODUCT(({yrs_rng}<={a('yr',c)})*({yrs_rng}>{a('yr',c)}-{a('dep')})*{cap_rng})/{a('dep')}")
yrow(PL, "ebit", "Operating profit (EBIT)", lambda i, c: f"={rr(PL,'ebitda',c)}-{rr(PL,'da',c)}")
yrow(PL, "intinc", "Interest income on prior year-end cash", lambda i, c: f"={a('cash0')}*{a('int')}" if i == 0 else f"={fwd('Cash Flow','close',prev(c))}*{a('int')}")
yrow(PL, "ebt", "Profit before tax", lambda i, c: f"={rr(PL,'ebit',c)}+{rr(PL,'intinc',c)}")
yrow(PL, "cum", "Cumulative profit before tax (loss pool when negative)", lambda i, c: f"={rr(PL,'ebt',c)}" if i == 0 else f"={prev(c)}{ROW[PL]}+{rr(PL,'ebt',c)}")
yrow(PL, "tax", "Income tax after loss carry-forward = rate x increase in positive cumulative profit", lambda i, c: f"=MAX(0,{rr(PL,'cum',c)})*{a('tax')}" if i == 0 else f"=MAX(0,MAX(0,{rr(PL,'cum',c)})-MAX(0,{rr(PL,'cum',prev(c))}))*{a('tax')}")
yrow(PL, "ni", "Net income", lambda i, c: f"={rr(PL,'ebt',c)}-{rr(PL,'tax',c)}", K, True)

# capex row lives on Headcount (driven by hires)
yrow(H, "capex", "Equipment capex = net new hires x capex per hire ($K)", lambda i, c: f"={rr(H,'hires',c)}*{a('capex')}")
CAPROW = R[(H, 'capex')]

# ================================================================ Cash Flow
CF = "Cash Flow"
header(CF, "Cash flow statement (active scenario)", "Indirect method. Financing = seed tranches and Series A in the years set on Assumptions.")
yrow(CF, "ni", "Net income", lambda i, c: f"={ref(PL,'ni',c)}")
yrow(CF, "da", "Add back depreciation", lambda i, c: f"={ref(PL,'da',c)}")
yrow(CF, "dar", "Less increase in receivables", lambda i, c: f"=-({fwd('Balance Sheet','ar',c)}-{'0' if i == 0 else fwd('Balance Sheet','ar',prev(c))})")
yrow(CF, "dap", "Add increase in payables", lambda i, c: f"={fwd('Balance Sheet','ap',c)}-{'0' if i == 0 else fwd('Balance Sheet','ap',prev(c))}")
yrow(CF, "cfo", "Cash flow from operations", lambda i, c: f"=SUM({rr(CF,'ni',c)}:{rr(CF,'dap',c)})", K, True)
yrow(CF, "capex", "Capital expenditure (equipment)", lambda i, c: f"=-{ref(H,'capex',c)}")
yrow(CF, "fcf", "Free cash flow (before financing)", lambda i, c: f"={rr(CF,'cfo',c)}+{rr(CF,'capex',c)}", K, True)
yrow(CF, "s1", "Seed tranche 1", lambda i, c: f"=IF({a('yr',c)}={a('seed1y')},{a('seed1')},0)")
yrow(CF, "s2", "Seed tranche 2", lambda i, c: f"=IF({a('yr',c)}={a('seed2y')},{a('seed2')},0)")
yrow(CF, "sa", "Series A", lambda i, c: f"=IF({a('yr',c)}={a('seriesAy')},{a('seriesA')},0)")
yrow(CF, "cff", "Cash flow from financing", lambda i, c: f"=SUM({rr(CF,'s1',c)}:{rr(CF,'sa',c)})", K, True)
yrow(CF, "net", "Net change in cash", lambda i, c: f"={rr(CF,'fcf',c)}+{rr(CF,'cff',c)}")
CLOSE_ROW = ROW[CF] + 1
yrow(CF, "open", "Opening cash", lambda i, c: f"={a('cash0')}" if i == 0 else f"={prev(c)}{CLOSE_ROW}")
yrow(CF, "close", "Closing cash", lambda i, c: f"={rr(CF,'open',c)}+{rr(CF,'net',c)}", K, True)
yrow(CF, "burn", "Average monthly net burn = MAX(0, -free cash flow) / 12", lambda i, c: f"=MAX(0,-{rr(CF,'fcf',c)})/12")
yrow(CF, "cumfcf", "Cumulative free cash flow", lambda i, c: f"={rr(CF,'fcf',c)}" if i == 0 else f"={prev(c)}{ROW[CF]}+{rr(CF,'fcf',c)}")
yrow(CF, "preA", "Cumulative free cash flow before the Series A year (0 from that year)", lambda i, c: f"=IF({a('yr',c)}<{a('seriesAy')},{rr(CF,'cumfcf',c)},0)")
yrow(CF, "seedonly", "Cash if only the seed is raised (both tranches, no Series A)", lambda i, c: f"={a('cash0')}+{a('seed1')}+{a('seed2')}+{rr(CF,'cumfcf',c)}")
yrow(CF, "run_m", "Month the seed-only cash runs out (linear within year)", lambda i, c:
     f"=IF({rr(CF,'seedonly',c)}<0,12*({a('cash0')}+{a('seed1')}+{a('seed2')})/({a('cash0')}+{a('seed1')}+{a('seed2')}-{rr(CF,'seedonly',c)}),\"\")" if i == 0 else
     f"=IF(AND({rr(CF,'seedonly',c)}<0,{rr(CF,'seedonly',prev(c))}>=0),12*({a('yr',c)}-1)+12*{rr(CF,'seedonly',prev(c))}/({rr(CF,'seedonly',prev(c))}-{rr(CF,'seedonly',c)}),\"\")", K1)
section(CF, "Funding requirement ($K)")
def presum(row_sheet, row_key, op="<"):
    return f"SUMPRODUCT(({yrs_rng}{op}{a('seriesAy')})*{q(row_sheet)}!$B${R[(row_sheet,row_key)]}:$H${R[(row_sheet,row_key)]})"
put(CF, "need_seed", "Seed need = deepest cash point before a mid-year Series A x (1 + buffer)",
    [f"=MAX(0,-MIN(0,MIN(B{R[(CF,'preA')]}:H{R[(CF,'preA')]}),{presum(CF,'fcf')}+0.5*{presum(CF,'fcf','=')}))*(1+{a('buffer')})"], K, bold=True)
put(CF, "need_total", "Total equity need over 7 years = deepest cumulative free cash flow x (1 + buffer)", [f"=MAX(0,-MIN(B{R[(CF,'cumfcf')]}:H{R[(CF,'cumfcf')]}))*(1+{a('buffer')})"], K, bold=True)
put(CF, "mincash", "Lowest year-end cash with the planned rounds (must stay above 0)", [f"=MIN(B{R[(CF,'close')]}:H{R[(CF,'close')]})"], K, bold=True)
rm = f"B{R[(CF,'run_m')]}:H{R[(CF,'run_m')]}"
put(CF, "runway", "Seed runway in months from close, without a Series A", [f"=IF(COUNT({rm})=0,\"beyond month 84\",ROUNDDOWN(SUM({rm}),0))"], N, bold=True)
put(CF, "y1burn", "Year-1 average monthly net burn", [f"=B{R[(CF,'burn')]}"], K)
section(CF, "Use of seed: years before the Series A year ($K)")
for d in DMAP:
    put(CF, "u_" + d, f"Operating expense: {d}", ["=" + presum(O, 'dep_' + d)], K)
put(CF, "u_cogs", "Cost of revenue (claims operations, hosting, variable)", ["=" + presum(O, 'cogs')], K)
put(CF, "u_capex", "Equipment capex", ["=-" + presum(CF, 'capex')], K)
put(CF, "u_wc", "Working capital (receivables build less payables)", [f"=-({presum(CF,'dar')}+{presum(CF,'dap')})"], K)
put(CF, "u_tax", "Income tax", ["=" + presum(PL, 'tax')], K)
put(CF, "u_gross", "Gross uses", [f"=SUM(B{R[(CF,'u_Engineering')]}:B{R[(CF,'u_tax')]})"], K, bold=True)
put(CF, "u_rev", "Less revenue earned in the period", ["=-" + presum(PL, 'rev')], K)
put(CF, "u_int", "Less interest income", ["=-" + presum(PL, 'intinc')], K)
put(CF, "u_net", "Net use of cash before the Series A year", [f"=SUM(B{R[(CF,'u_gross')]}:B{R[(CF,'u_int')]})"], K, bold=True)
put(CF, "u_seed", "Seed raised (both tranches)", [f"={a('seed1')}+{a('seed2')}"], K)
put(CF, "u_res", "Seed remaining at the start of the Series A year", [f"=B{R[(CF,'u_seed')]}+{a('cash0')}-B{R[(CF,'u_net')]}"], K, bold=True)
put(CF, "own", "Seed investor ownership at the assumed pre-money (both tranches at one price, before option pool)", [f"=({a('seed1')}+{a('seed2')})/({a('pre')}+{a('seed1')}+{a('seed2')})"], P)

# ================================================================ Balance Sheet
BS = "Balance Sheet"
header(BS, "Balance sheet at year end (active scenario)", "Asset-light: scoup.ai never holds customer funds. The check row must be zero.")
yrow(BS, "cash", "Cash", lambda i, c: f"={ref(CF,'close',c)}")
yrow(BS, "ar", "Accounts receivable = revenue x DSO / 365", lambda i, c: f"={ref(PL,'rev',c)}*{a('dso')}/365")
yrow(BS, "ppe", "Equipment, net", lambda i, c: f"={ref(H,'capex',c)}-{ref(PL,'da',c)}" if i == 0 else f"={prev(c)}{ROW[BS]}+{ref(H,'capex',c)}-{ref(PL,'da',c)}")
yrow(BS, "ta", "Total assets", lambda i, c: f"=SUM({rr(BS,'cash',c)}:{rr(BS,'ppe',c)})", K, True)
yrow(BS, "ap", "Accounts payable = non-payroll costs x DPO / 365", lambda i, c: f"=({ref(O,'cogs_host',c)}+{ref(O,'cogs_var',c)}+" + "+".join(ref(O, k, c) for k in ["o_sec", "o_legal", "o_mkt", "o_trav", "o_off", "o_partner"]) + f")*{a('dpo')}/365")
yrow(BS, "tl", "Total liabilities", lambda i, c: f"={rr(BS,'ap',c)}", K, True)
yrow(BS, "paid", "Paid-in capital", lambda i, c: f"={a('cash0')}+{ref(CF,'cff',c)}" if i == 0 else f"={prev(c)}{ROW[BS]}+{ref(CF,'cff',c)}")
yrow(BS, "re", "Retained earnings (accumulated deficit)", lambda i, c: f"={ref(PL,'ni',c)}" if i == 0 else f"={prev(c)}{ROW[BS]}+{ref(PL,'ni',c)}")
yrow(BS, "te", "Total equity", lambda i, c: f"={rr(BS,'paid',c)}+{rr(BS,'re',c)}", K, True)
yrow(BS, "tle", "Total liabilities and equity", lambda i, c: f"={rr(BS,'tl',c)}+{rr(BS,'te',c)}", K, True)
yrow(BS, "chk", "Check: assets minus liabilities and equity (must be 0)", lambda i, c: f"=ROUND({rr(BS,'ta',c)}-{rr(BS,'tle',c)},6)")

# ================================================================ Unit Economics
U = "Unit Economics"
header(U, "Unit economics (active scenario)", "Direct segments (shippers + SME importers): CAC = sales and marketing cost excluding partner commission / new direct accounts. Carriers: CAC = partner commission / new carrier accounts. LTV = revenue per account x gross margin / churn (undiscounted). Company gross margin is negative in early years, so read years 3-7.")
yrow(U, "new", "New direct accounts won (shippers + SME importers)", lambda i, c: f"={ref(S,'new_shp',c)}+{ref(S,'new_imp',c)}", N)
yrow(U, "sm", "Sales and marketing cost excluding partner commission ($K)", lambda i, c: f"={ref(O,'sm',c)}-{ref(O,'o_partner',c)}")
yrow(U, "cac", "CAC per new account = S&M / new accounts ($K)", lambda i, c: f"=IF({rr(U,'new',c)}=0,0,{rr(U,'sm',c)}/{rr(U,'new',c)})", K1, True)
yrow(U, "rpa", "Revenue per direct account = (shipper + importer ARR) / their accounts ($K)", lambda i, c: f"=IF({ref(S,'end_shp',c)}+{ref(S,'end_imp',c)}=0,0,({ref(S,'arr_shp',c)}+{ref(S,'arr_imp',c)})/({ref(S,'end_shp',c)}+{ref(S,'end_imp',c)}))", K1)
yrow(U, "gm", "Gross margin (company level)", lambda i, c: f"={ref(PL,'gm',c)}", P)
yrow(U, "gpa", "Gross profit per account per year = revenue per account x gross margin ($K)", lambda i, c: f"={rr(U,'rpa',c)}*{rr(U,'gm',c)}", K1)
yrow(U, "life", "Expected account lifetime (years) = 1 / churn", lambda i, c: f"=1/{live('churn')}", K1)
yrow(U, "ltv", "LTV = gross profit per account / churn ($K)", lambda i, c: f"={rr(U,'gpa',c)}*{rr(U,'life',c)}", K1, True)
yrow(U, "ltvcac", "LTV : CAC", lambda i, c: f"=IF(OR({rr(U,'cac',c)}<=0,{rr(U,'ltv',c)}<=0),\"n/m\",{rr(U,'ltv',c)}/{rr(U,'cac',c)})", X, True)
yrow(U, "pay", "CAC payback = CAC / (gross profit per account / 12), months", lambda i, c: f"=IF({rr(U,'gpa',c)}<=0,\"n/m\",{rr(U,'cac',c)}/({rr(U,'gpa',c)}/12))", K1, True)
yrow(U, "nrr", "Net revenue retention", lambda i, c: f"={ref(S,'nrr',c)}", P)
yrow(U, "smr", "S&M per $1 of new ARR = S&M / (new accounts x revenue per account)", lambda i, c: f"=IF({rr(U,'new',c)}=0,0,{rr(U,'sm',c)}/({rr(U,'new',c)}*{rr(U,'rpa',c)}))", '0.00')
yrow(U, "cac_b", "CAC at the $2.00 benchmark = 2.00 x revenue per account ($K)", lambda i, c: f"={a('bench_sm')}*{rr(U,'rpa',c)}", K1)
yrow(U, "ltvcac_b", "LTV : CAC at the benchmark CAC", lambda i, c: f"=IF({rr(U,'ltv',c)}<=0,\"n/m\",{rr(U,'ltv',c)}/{rr(U,'cac_b',c)})", X)
yrow(U, "pay_b", "CAC payback at the benchmark CAC, months", lambda i, c: f"=IF({rr(U,'gpa',c)}<=0,\"n/m\",{rr(U,'cac_b',c)}/({rr(U,'gpa',c)}/12))", K1)
section(U, "Carriers (partner-led segment)")
yrow(U, "car_new", "New carrier accounts", lambda i, c: f"={ref(S,'new_car',c)}", N)
yrow(U, "car_cac", "Carrier CAC = partner commission / new carrier accounts ($K)", lambda i, c: f"=IF({rr(U,'car_new',c)}=0,0,{ref(O,'o_partner',c)}/{rr(U,'car_new',c)})", K1)
yrow(U, "car_rpa", "Carrier revenue per account ($K)", lambda i, c: f"={ref(S,'rpa_car',c)}", K1)
yrow(U, "car_ltv", "Carrier LTV = revenue per account x gross margin / churn ($K)", lambda i, c: f"={rr(U,'car_rpa',c)}*{rr(U,'gm',c)}/{live('churn')}", K1)
section(U, "Pessimistic acquisition cost (direct segments)")
yrow(U, "cac_p", "Pessimistic CAC: paid-media cost per small-company customer ($K, Metadata 2026)", lambda i, c: f"={a('pess_cac')}", K1)
yrow(U, "ltvcac_p", "LTV : CAC at the pessimistic CAC", lambda i, c: f"=IF({rr(U,'ltv',c)}<=0,\"n/m\",{rr(U,'ltv',c)}/{rr(U,'cac_p',c)})", X)
yrow(U, "pay_p", "CAC payback at the pessimistic CAC, months", lambda i, c: f"=IF({rr(U,'gpa',c)}<=0,\"n/m\",{rr(U,'cac_p',c)}/({rr(U,'gpa',c)}/12))", K1)

# ================================================================ Scenarios (compact parallel engine)
SN = "Scenarios"; ws = sheets[SN]
ws["A1"] = "Scenarios: Base, Bull and Bear computed side by side ($K)"; ws["A1"].font = Font(bold=True, size=13)
ws["A2"] = ("Same logic as the main tabs, run once per scenario column of Assumptions. The scenarios differ only in the inputs "
            "listed under Scenario inputs on Assumptions. Check rows at the bottom compare the active scenario with the main tabs.")
ws.column_dimensions["A"].width = 60
for c in YC: ws.column_dimensions[c].width = 12
ROW[SN] = 4
SCOL = {"Base": "B", "Bull": "C", "Bear": "D"}
OTHER = ["o_sec", "o_legal", "o_mkt", "o_trav", "o_off", "o_partner"]

def scen_block(s):
    sv = lambda key, col=SCOL[s]: ref(A, key, col, None, True)
    r0 = ROW[SN]; ROW[SN] += 1
    ws.cell(r0, 1, f"{s} case").font = HDR
    for c in YC:
        ws[f"{c}{r0}"] = f"=\"Y\"&{a('yr', c)}"; ws[f"{c}{r0}"].font = HDR
    for cc in range(1, 9): ws.cell(r0, cc).fill = FILL
    p = s + "_"
    def g(key, c): return rr(SN, p + key, c)
    seg_engine(SN, p, lambda c: a('new_'+s, c), lambda c: a('car_'+s, c), sv('churn'), sv('rmult'), detail=False)
    for role in ROLES:
        k, scl = role[0], role[9]
        def f(i, c, k=k, scl=scl):
            base = f"ROUND({a('hc_'+k, c)}*{sv('scale')},0)" if scl else f"{a('hc_'+k, c)}"
            if i == 0: return f"={base}"
            return f"=IF(AND({sv('freeze')}>0,{a('yr', c)}>={sv('freeze')},{a('yr', c)}<{sv('freeze')}+{sv('fdur')}),{prev(c)}{ROW[SN]},{base})"
        yrow(SN, p+"n_"+k, f"  {role[1]}", f, N)
    yrow(SN, p+"hc", "Headcount at year end", lambda i, c: f"=SUM({g('n_ceo',c)}:{g('n_fin',c)})", N, True)
    def cost(i, c, ks):
        parts = []
        for k in ks:
            n = g('n_' + k, c)
            fte = f"{n}*(5-{a('sq_'+k)})/4" if i == 0 else f"({g('n_'+k,prev(c))}+{n})/2"
            parts.append(f"{fte}*{a('cost_'+k)}")
        return "=(" + "+".join(parts) + f")*(1+{a('infl')})^({a('yr', c)}-1)"
    yrow(SN, p+"ppl_cogs", "Claims operations people cost", lambda i, c: cost(i, c, ["cs"]))
    yrow(SN, p+"ppl_op", "Other people cost", lambda i, c: cost(i, c, [k for k in LAB if k != "cs"]))
    for k, lab, v, line, s3 in OPX:
        yrow(SN, p+k, f"  {lab}", lambda i, c, k=k: f"={a(k, c)}" if i == 0 else f"=IF(AND({sv('freeze')}>0,{a('yr', c)}>={sv('freeze')},{a('yr', c)}<{sv('freeze')}+{sv('fdur')}),{prev(c)}{ROW[SN]},{a(k, c)}*{sv('scale')})")
    yrow(SN, p+"o_partner", "  Partner commission on carrier revenue", lambda i, c: f"={g('rev_car',c)}*{a('partner')}")
    return sv, p, g

def scen_block2(s, sv, p, g):
    yrow(SN, p+"cogs", "Cost of revenue", lambda i, c: f"={g('ppl_cogs',c)}+{g('o_host',c)}+{g('rev',c)}*{sv('varc')}")
    yrow(SN, p+"gp", "Gross profit", lambda i, c: f"={g('rev',c)}-{g('cogs',c)}")
    yrow(SN, p+"gm", "Gross margin", lambda i, c: f"=IF({g('rev',c)}=0,0,{g('gp',c)}/{g('rev',c)})", P)
    yrow(SN, p+"opex", "Operating expense", lambda i, c: f"={g('ppl_op',c)}+" + "+".join(g(k, c) for k in OTHER))
    yrow(SN, p+"ebitda", "EBITDA", lambda i, c: f"={g('gp',c)}-{g('opex',c)}", K, True)
    yrow(SN, p+"capex", "Capex", lambda i, c: f"={a('capex')}*" + (g('hc', c) if i == 0 else f"MAX(0,{g('hc',c)}-{g('hc',prev(c))})"))
    capr = f"$B${R[(SN,p+'capex')]}:$H${R[(SN,p+'capex')]}"
    yrow(SN, p+"da", "Depreciation", lambda i, c: f"=SUMPRODUCT(({yrs_rng}<={a('yr',c)})*({yrs_rng}>{a('yr',c)}-{a('dep')})*{capr})/{a('dep')}")
    yrow(SN, p+"ebt", "Profit before tax", lambda i, c: f"={g('ebitda',c)}-{g('da',c)}+" + (a('cash0') if i == 0 else fwd(SN, p+'cash', prev(c))) + f"*{a('int')}")
    yrow(SN, p+"cum", "Cumulative profit before tax", lambda i, c: f"={g('ebt',c)}" if i == 0 else f"={prev(c)}{ROW[SN]}+{g('ebt',c)}")
    yrow(SN, p+"tax", "Tax", lambda i, c: f"=MAX(0,{g('cum',c)})*{a('tax')}" if i == 0 else f"=MAX(0,MAX(0,{g('cum',c)})-MAX(0,{g('cum',prev(c))}))*{a('tax')}")
    yrow(SN, p+"ni", "Net income", lambda i, c: f"={g('ebt',c)}-{g('tax',c)}", K, True)
    yrow(SN, p+"ar", "Receivables", lambda i, c: f"={g('rev',c)}*{a('dso')}/365")
    yrow(SN, p+"ap", "Payables", lambda i, c: f"=({g('o_host',c)}+{g('rev',c)}*{sv('varc')}+" + "+".join(g(k, c) for k in OTHER) + f")*{a('dpo')}/365")
    def fcf(i, c):
        dar = g('ar', c) if i == 0 else f"{g('ar',c)}-{g('ar',prev(c))}"
        dap = g('ap', c) if i == 0 else f"{g('ap',c)}-{g('ap',prev(c))}"
        return f"={g('ni',c)}+{g('da',c)}-({dar})+({dap})-{g('capex',c)}"
    yrow(SN, p+"fcf", "Free cash flow (before financing)", fcf, K, True)
    def cash(i, c):
        start = a('cash0') if i == 0 else f"{prev(c)}{ROW[SN]}"
        rounds = f"IF({a('yr',c)}={a('seed1y')},{a('seed1')},0)+IF({a('yr',c)}={a('seed2y')},{a('seed2')},0)+IF({a('yr',c)}={a('seriesAy')},{a('seriesA')},0)"
        return f"={start}+{g('fcf',c)}+{rounds}"
    yrow(SN, p+"cash", "Closing cash with the planned rounds", cash, K, True)
    yrow(SN, p+"cumfcf", "Cumulative free cash flow", lambda i, c: f"={g('fcf',c)}" if i == 0 else f"={prev(c)}{ROW[SN]}+{g('fcf',c)}")
    yrow(SN, p+"preA", "Cumulative FCF before the Series A year", lambda i, c: f"=IF({a('yr',c)}<{a('seriesAy')},{g('cumfcf',c)},0)")
    fcfr = f"$B${R[(SN,p+'fcf')]}:$H${R[(SN,p+'fcf')]}"
    put(SN, p+"mincash", "Lowest year-end cash with the planned rounds", [f"=MIN(B{R[(SN,p+'cash')]}:H{R[(SN,p+'cash')]})"], K, bold=True)
    put(SN, p+"need", "Total equity need incl. buffer", [f"=MAX(0,-MIN(B{R[(SN,p+'cumfcf')]}:H{R[(SN,p+'cumfcf')]}))*(1+{a('buffer')})"], K, bold=True)
    deep = f"MIN(0,MIN(B{R[(SN,p+'preA')]}:H{R[(SN,p+'preA')]}),SUMPRODUCT(({yrs_rng}<{a('seriesAy')})*{fcfr})+0.5*SUMPRODUCT(({yrs_rng}={a('seriesAy')})*{fcfr}))"
    put(SN, p+"seedneed", "Seed need incl. buffer (deepest point before a mid-year Series A)", [f"=MAX(0,-{deep})*(1+{a('buffer')})"], K, bold=True)
    M_ = a('milestone')
    yrow(SN, p+"mile_m", "Month ARR crosses the Series A milestone (linear within year)", lambda i, c:
         f"=IF({g('arr',c)}>={M_},12*{M_}/{g('arr',c)},\"\")" if i == 0 else
         f"=IF(AND({g('arr',c)}>={M_},{g('arr',prev(c))}<{M_}),12*({a('yr', c)}-1)+12*({M_}-{g('arr',prev(c))})/({g('arr',c)}-{g('arr',prev(c))}),\"\")", K1)
    mm_ = f"B{R[(SN,p+'mile_m')]}:H{R[(SN,p+'mile_m')]}"
    put(SN, p+"mile", "Series A milestone month", [f"=IF(COUNT({mm_})=0,\"not reached\",ROUNDUP(SUM({mm_}),0))"], N, bold=True)
    tot = f"({a('cash0')}+{a('seed1')}+{a('seed2')})"
    yrow(SN, p+"seedonly", "Cash if only the seed is raised", lambda i, c: f"={tot}+{g('cumfcf',c)}")
    yrow(SN, p+"run_m", "Month seed-only cash runs out (linear within year)", lambda i, c:
         f"=IF({g('seedonly',c)}<0,12*{tot}/({tot}-{g('seedonly',c)}),\"\")" if i == 0 else
         f"=IF(AND({g('seedonly',c)}<0,{g('seedonly',prev(c))}>=0),12*({a('yr',c)}-1)+12*{g('seedonly',prev(c))}/({g('seedonly',prev(c))}-{g('seedonly',c)}),\"\")", K1)
    rm_ = f"B{R[(SN,p+'run_m')]}:H{R[(SN,p+'run_m')]}"
    put(SN, p+"runway", "Seed runway in months, without a Series A", [f"=IF(COUNT({rm_})=0,\"beyond month 84\",ROUNDDOWN(SUM({rm_}),0))"], N, bold=True)
    blank(SN)

for s in SCEN:
    scen_block2(s, *scen_block(s))
section(SN, "Consistency checks: active scenario on this tab minus main tabs (all must be 0)")
for key, sheet, mk in [("rev", S, "rev"), ("ebitda", PL, "ebitda"), ("ni", PL, "ni"), ("fcf", CF, "fcf"), ("cash", CF, "close")]:
    yrow(SN, "chk_" + key, f"Check {key}", lambda i, c, key=key, sheet=sheet, mk=mk: f"=ROUND(CHOOSE({a('sel')},{rr(SN,'Base_'+key,c)},{rr(SN,'Bull_'+key,c)},{rr(SN,'Bear_'+key,c)})-{ref(sheet,mk,c)},6)")

# ================================================================ resolve forward-reference tokens, save
import re
TOK = re.compile(r"<<([^|>]+)\|([^|>]+)\|([A-Z]+)>>")
for wsx in wb.worksheets:
    for row in wsx.iter_rows():
        for cell in row:
            v = cell.value
            if isinstance(v, str) and v.startswith("="):
                v = TOK.sub(lambda m: ref(m.group(1), m.group(2), m.group(3), wsx.title), v)
                cell.value = v.replace("{CAPROW}", str(CAPROW))
wb["Assumptions"].sheet_properties.tabColor = "0000CC"
wb.calculation.fullCalcOnLoad = True
wb.save(OUT)
if not OVR:  # override builds (verify_model.py) must not overwrite the baseline metadata
  json.dump({"rows": {f"{k[0]}|{k[1]}": v for k, v in R.items()}, "inputs": INPUT_LOG},
            open(os.path.join(HERE, "rowmap.json"), "w"), indent=0, default=str)
print("saved", os.path.abspath(OUT))
