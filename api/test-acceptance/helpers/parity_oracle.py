# Test-owned parity oracle: uses only the public modules ingest_bytes and DeterministicStubProvider.
import sys, json, base64
from freight_recovery.ingest import ingest_bytes
from freight_recovery.extraction import DeterministicStubProvider

items = json.load(open(sys.argv[1], encoding="utf-8"))
prov = DeterministicStubProvider()
out = []
for it in items:
    data = base64.b64decode(it["b64"])
    try:
        doc = ingest_bytes(it["name"], data)
    except Exception as e:
        out.append({"error": type(e).__name__})
        continue
    ext = prov.extract(doc)
    out.append({
        "doc_type": doc.doc_type.value,
        "sha256": doc.sha256,
        "warnings": list(doc.warnings),
        "text": doc.text,
        "extraction": ext.model_dump(mode="json") if ext is not None else None,
    })
print(json.dumps(out))
