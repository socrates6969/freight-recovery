"""Evidence packet, pipeline and API tests."""

from __future__ import annotations

from datetime import datetime

from fastapi.testclient import TestClient

from freight_recovery.api.main import app
from freight_recovery.models import Perspective
from freight_recovery.pipeline import run_pipeline

NOW = datetime(2025, 3, 15, 9, 0)
client = TestClient(app)


def test_packet_contents_shipper(ld5001):
    packet = run_pipeline(ld5001, Perspective.SHIPPER, now=NOW)
    assert packet.load_number == "LD-5001"
    assert str(packet.result.recoverable_total) == "325.00"
    assert str(packet.result.pending_review_total) == "150.00"
    assert len(packet.documents) == 3 and all(len(d["sha256"]) == 64 for d in packet.documents)
    assert "DRAFT - FOR HUMAN REVIEW" in packet.demand_letter
    assert "$325.00" in packet.demand_letter
    assert "$475.00" not in packet.demand_letter and "Lumper" not in packet.demand_letter
    assert "needs human review" in packet.markdown
    assert "not legal or financial advice" in packet.disclaimer


def test_packet_is_deterministic(ld5001):
    a = run_pipeline(ld5001, Perspective.SHIPPER, now=NOW)
    b = run_pipeline(ld5001, Perspective.SHIPPER, now=NOW)
    assert a.markdown == b.markdown


def test_carrier_letter_requests_payment(ld5002):
    packet = run_pipeline(ld5002, Perspective.CARRIER, now=NOW)
    assert "request payment of $162.50" in packet.demand_letter
    assert "To: Widget Co" in packet.demand_letter


def test_health():
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_openapi_documents_surface():
    spec = client.get("/openapi.json").json()
    assert "/v1/analyze" in spec["paths"] and "/v1/analyze/text" in spec["paths"]
    assert "pre-product" in spec["info"]["title"].lower()


def test_analyze_text_endpoint(ld5001):
    body = {
        "perspective": "shipper",
        "documents": [{"filename": n, "content": b.decode()} for n, b in ld5001],
    }
    r = client.post("/v1/analyze/text", json=body)
    assert r.status_code == 200
    assert r.json()["packet"]["result"]["recoverable_total"] == "325.00"


def test_analyze_upload_endpoint(ld5002):
    files = [("files", (n, b, "text/csv")) for n, b in ld5002]
    r = client.post("/v1/analyze", files=files, data={"perspective": "carrier"})
    assert r.status_code == 200
    assert r.json()["packet"]["result"]["findings"][0]["rule_id"] == "DET-UNBILLED"


def test_analyze_rejects_empty_documents():
    assert client.post("/v1/analyze/text", json={"documents": []}).status_code == 422
