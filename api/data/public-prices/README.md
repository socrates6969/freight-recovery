# Bundled public price history

This directory holds two public U.S. government price series. The cost outlook backtest gate
(`npm run eval:outlook`) runs on them, and `npm run prices:import -- --bundled` (also run by
`npm run db:seed`) loads them into the global price tables. `manifest.json` records the sha256 of each
file, the pinned source URL, the retrieval date, the row count and the first and last dates. The
evaluation and the importer refuse a file whose sha256 does not match.

| File | Series | Source |
| --- | --- | --- |
| `GASDESW.csv` | Weekly U.S. average diesel retail price, USD per gallon (`diesel_us`) | U.S. Energy Information Administration, US Diesel Sales Price [GASDESW], retrieved from FRED, Federal Reserve Bank of St. Louis. Series page: https://fred.stlouisfed.org/series/GASDESW |
| `PCU4841214841212.csv` | Monthly producer price index, long-distance truckload, Jun 1992 = 100 (`ppi_tl`) | U.S. Bureau of Labor Statistics, Producer Price Index by Industry: General Freight Trucking, Long-Distance Truckload [PCU4841214841212], retrieved from FRED, Federal Reserve Bank of St. Louis. Series page: https://fred.stlouisfed.org/series/PCU4841214841212 |

- Licence: public domain (U.S. government data); citation requested.
- Retrieved: 2026-10-11, from the CSV download URLs recorded in `manifest.json`
  (`https://fred.stlouisfed.org/graph/fredgraph.csv?id=<series id>`).
- The files are stored byte for byte as downloaded and are marked `-text` in `.gitattributes`, so no
  line-ending conversion changes their sha256.
- The most recent PPI values are preliminary and the source may revise them. A later import replaces the
  active snapshot; earlier imports are kept (append-only).

No customer, carrier or shipment data is included in this directory.
