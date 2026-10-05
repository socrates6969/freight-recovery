"""FastAPI surface. OpenAPI docs at ``/docs`` and ``/openapi.json``.

MVP: stateless, no auth, no database. Do NOT expose publicly as-is.
TODO: authentication, tenant isolation, persistence (Postgres/RDS), async jobs,
size limits, malware scanning of uploads, audit log.
"""

from __future__ import annotations

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from freight_recovery import __version__
from freight_recovery.models import AnalysisResponse, Perspective
from freight_recovery.pipeline import run_pipeline

app = FastAPI(
    title="Freight Recovery API (MVP, pre-product)",
    version=__version__,
    description=(
        "Ingest freight invoice / rate confirmation / BOL, apply detention and "
        "invoice-error rules, and return a recovery estimate with an evidence packet "
        "and DRAFT demand letter. Pre-product MVP: not production-ready."
    ),
)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class TextDocument(BaseModel):
    """A document supplied inline as text/CSV content."""

    filename: str = Field(examples=["invoice.txt"])
    content: str


class TextAnalyzeRequest(BaseModel):
    """Inline-document analysis request."""

    perspective: Perspective = Perspective.SHIPPER
    documents: list[TextDocument] = Field(min_length=1)


class Health(BaseModel):
    """Liveness response."""

    status: str
    version: str


@app.get("/health", response_model=Health, tags=["meta"])
def health() -> Health:
    """Liveness probe (used by container/ALB health checks)."""
    return Health(status="ok", version=__version__)


@app.post("/v1/analyze", response_model=AnalysisResponse, tags=["analysis"])
async def analyze_files(
    files: list[UploadFile] = File(description="Invoice, rate confirmation, BOL (PDF/CSV/TXT)."),
    perspective: Perspective = Form(Perspective.SHIPPER),
) -> AnalysisResponse:
    """Analyze uploaded documents for ONE load and return the evidence packet."""
    payload: list[tuple[str, bytes]] = []
    for f in files:
        data = await f.read()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"{f.filename} exceeds {MAX_UPLOAD_BYTES} bytes")
        payload.append((f.filename or "upload", data))
    try:
        return AnalysisResponse(packet=run_pipeline(payload, perspective))
    except RuntimeError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/v1/analyze/text", response_model=AnalysisResponse, tags=["analysis"])
def analyze_text(req: TextAnalyzeRequest) -> AnalysisResponse:
    """Analyze inline text/CSV documents (handy for tests and integrations)."""
    payload = [(d.filename, d.content.encode("utf-8")) for d in req.documents]
    return AnalysisResponse(packet=run_pipeline(payload, req.perspective))
