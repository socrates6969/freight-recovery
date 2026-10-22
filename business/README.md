# Scoup - business documents

Pre-revenue. Every company number is a plan input or model output; outside figures are
footnoted. Start with the investor brief.

| File | What it is |
|---|---|
| [`investor-brief.md`](investor-brief.md) | Short investor overview: agents, market, model, financing |
| [`business-model.md`](business-model.md) | Who pays and why, pricing, unit economics, go-to-market, competition, risks, roadmap |
| [`business-plan.md`](business-plan.md) | Plan with evidence gates and kill triggers |
| [`market-analysis.md`](market-analysis.md) | Market size (bottom-up) and competitors |
| [`data-and-sources.md`](data-and-sources.md) | Every outside figure with source, URL and dates; assumptions; unverified items; spreadsheet change log |
| [`investor-pack/scoup-financial-model.xlsx`](investor-pack/scoup-financial-model.xlsx) | The planning model (see `../financial/model.md`) |
| [`figures/`](figures/) | Charts used in the documents (PNG and SVG), built by `tools/make_figures.py` |
| [`tools/`](tools/) | Scripts: recalculate the model without Excel, apply the source updates, draw the figures |

Norwegian versions (`*.no.md`) lag the English files; see the note at the top of each.
The PDF investor pack in the main checkout (`investor-pack/0*.pdf`) predates these documents
and is not committed here; regenerate it from the markdown before any use.