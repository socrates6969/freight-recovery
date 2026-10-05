"""FastAPI surface. OpenAPI docs at ``/docs`` and ``/openapi.json``.

MVP: stateless, no auth, no database. Do NOT expose publicly as-is.
TODO (see README "Before real customer data"): authentication, tenant isolation,
persistence (Postgres/RDS), async jobs, malware scanning of uploads, audit log,
sandboxed PDF parsing, edge (WAF/ALB) body limits and rate limiting.

Input hardening that IS in place: request-body cap (middleware), per-file and
file-count caps enforced before/while reading, bounded JSON fields on the text
endpoint, and all domain/parse failures mapped to 4xx with fixed messages.
"""

from __future__ import annotations

import decimal

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, ValidationError
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from freight_recovery import __version__
from freight_recovery.errors import InputError
from freight_recovery.models import AnalysisResponse, Perspective
from freight_recovery.pipeline import run_pipeline

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_FILES = 10
MAX_REQUEST_BYTES = 25 * 1024 * 1024  # whole request body (multipart or JSON)
MAX_TEXT_CHARS = 1_000_000  # per inline document on /v1/analyze/text
MAX_FILENAME = 255

UNPROCESSABLE = "The submitted documents could not be processed."


class _BodyTooLarge(Exception):
    pass


class BodySizeLimitMiddleware:
    """Reject over-large request bodies (Content-Length up front, byte count while streaming)."""

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_REQUEST_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max_bytes:
            await self._reject(scope, receive, send)
            return
        seen = 0
        started = False

        async def counting_receive() -> Message:
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max_bytes:
                    raise _BodyTooLarge
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except _BodyTooLarge:
            if started:
                raise
            await self._reject(scope, receive, send)

    async def _reject(self, scope: Scope, receive: Receive, send: Send) -> None:
        response = JSONResponse(
            {"detail": f"Request body exceeds {self.max_bytes} bytes."}, status_code=413
        )
        await response(scope, receive, send)


app = FastAPI(
    title="Freight Recovery API (MVP, pre-product)",
    version=__version__,
    description=(
        "Ingest freight invoice / rate confirmation / BOL, apply detention and "
        "invoice-error rules, and return a recovery estimate with an evidence packet "
        "and DRAFT demand letter. Pre-product MVP: not production-ready."
    ),
)
app.add_middleware(BodySizeLimitMiddleware)


@app.exception_handler(RequestValidationError)
async def _validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    """422 with field paths and codes only; never echo the submitted values."""
    detail = [{"loc": list(e.get("loc", ())), "type": e.get("type", "invalid")} for e in exc.errors()]
    return JSONResponse({"detail": detail}, status_code=422)


class TextDocument(BaseModel):
    """A document supplied inline as text/CSV content."""

    filename: str = Field(max_length=MAX_FILENAME, examples=["invoice.txt"])
    content: str = Field(max_length=MAX_TEXT_CHARS)


class TextAnalyzeRequest(BaseModel):
    """Inline-document analysis request."""

    perspective: Perspective = Perspective.SHIPPER
    documents: list[TextDocument] = Field(min_length=1, max_length=MAX_FILES)


class Health(BaseModel):
    """Liveness response."""

    status: str
    version: str


def _run(payload: list[tuple[str, bytes]], perspective: Perspective) -> AnalysisResponse:
    """Run the pipeline, mapping every input-caused failure to a fixed 4xx message."""
    try:
        return AnalysisResponse(packet=run_pipeline(payload, perspective))
    except InputError as exc:
        raise HTTPException(422, str(exc)) from exc
    except (ValidationError, decimal.DecimalException, ArithmeticError, UnicodeError) as exc:
        # Malformed numbers (NaN/Infinity/huge exponents) and schema failures. The
        # exception text can contain document content, so it is deliberately not returned.
        raise HTTPException(422, UNPROCESSABLE) from exc


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
    if len(files) > MAX_FILES:
        raise HTTPException(413, f"At most {MAX_FILES} files per request.")
    payload: list[tuple[str, bytes]] = []
    for f in files:
        # Check the spooled size BEFORE reading, then read with a hard bound so a
        # lying size can never load more than MAX_UPLOAD_BYTES + 1 into memory.
        if f.size is not None and f.size > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"A file exceeds {MAX_UPLOAD_BYTES} bytes.")
        data = await f.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"A file exceeds {MAX_UPLOAD_BYTES} bytes.")
        payload.append(((f.filename or "upload")[:MAX_FILENAME], data))
    # CPU-bound parsing runs in a worker thread so one request cannot stall the event loop.
    return await run_in_threadpool(_run, payload, perspective)


@app.post("/v1/analyze/text", response_model=AnalysisResponse, tags=["analysis"])
def analyze_text(req: TextAnalyzeRequest) -> AnalysisResponse:
    """Analyze inline text/CSV documents (handy for tests and integrations)."""
    payload = [(d.filename, d.content.encode("utf-8")) for d in req.documents]
    return _run(payload, req.perspective)
