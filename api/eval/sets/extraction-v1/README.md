# Evaluation set `extraction-v1` (synthetic)

Every file under `cases/` is synthetic test data written for this repository (the `oracle_ld5001_*` and
`oracle_ld5002_*` files are byte copies of the synthetic fixtures in `tests/fixtures/`). No file contains
customer data.

Results computed on this set are **not an accuracy measure**. They only show whether the deterministic
extraction stage (the API's pre-store checks plus the sandboxed parse job) reproduces known answers and
whether repeated runs agree. The CI gate `--min-pass-hat-k 1` applies to this regression set only and
says nothing about real documents.

## Composition (30 cases)

| Basis | Count | How the expected values were obtained |
|---|---|---|
| `python_oracle` | 9 (6 repository fixtures + 3 simple text documents) | Output of the Python reference `tools/parity/extract_dump.py` (`freight_recovery.extraction.DeterministicStubProvider`) run on each file under its presented name, converted to `(key, groupIndex, value)` triples and committed as data. Never generated from the TypeScript implementation. |
| `hand_authored`, outcome `rejected` | 9 | Written by hand from the step 3 rejection rules (N6): empty file, markup content, binary content, unsupported extension, ZIP signature, type/extension mismatch, truncated PDF header (`malformed_pdf`), PNG with trailing data, CSV with a bare carriage return inside an unquoted record (`malformed_csv`). |
| `hand_authored`, outcome `parsed` | 12 | Written by hand from the extraction rules (N7): missing load number, duplicate keys (last wins), unreadable charge amount (charge skipped), parenthesised negatives, `$`/`USD`/thousands-separator money forms, CRLF + BOM text, rate confirmation `authorized_accessorials` list, BOL with `MM/DD/YYYY HH:MM`, `YYYY-MM-DD HH:MM:SS` and ISO `T` datetimes, a document with no recognizable keys (type `OTHER`, zero fields), an unparseable total (field kept with a null value), a valid PNG (no OCR: `OTHER`, zero fields), and `=` delimiters with aliases. |

Notes:
- One hand-written expectation was corrected while building the set: a CSV with an unterminated quote
  was first expected to be rejected, but the CPython `csv` reader the parser ports (`strict=False`) accepts
  an unterminated quote at end of input. The case was replaced by a bare carriage return inside an
  unquoted record, which both implementations reject.
- No case falls under the registered TypeScript/Python divergences D1-D8 of step 3; such cases would be
  labeled `hand_authored`.
- Every case file is smaller than 20 KiB. `manifest.json` lists the cases in order; `evalSetSha256` is the
  SHA-256 of the manifest bytes followed by each case file's bytes in manifest order.

Run: `npm run build && npm run eval -- --set api/eval/sets/extraction-v1 --k 3 --min-pass-hat-k 1`
(add `--json` for machine output, `--record` with `DATABASE_URL` to store the run for the Dev dashboard).
