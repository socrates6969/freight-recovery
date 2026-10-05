"""FastAPI surface (``create_app`` factory + module-level ``app`` for uvicorn).

Security model
--------------
* Every route except ``GET /health`` requires an API key (see ``freight_recovery.auth``)
  and runs as exactly one tenant, derived from the key. All persisted and retrieved
  data is scoped to that tenant; another tenant's analysis id is a 404.
* ``/docs`` and ``/openapi.json`` are OFF by default (``FR_DOCS_MODE=off``); ``auth``
  serves them only with a valid key; ``open`` (local dev only) is refused in production.
* Request bodies are capped (middleware), file counts/sizes are bounded while reading,
  JSON fields are bounded, and every domain/parse failure is a 4xx with a fixed message.
* CPU-bound parsing runs in a separate, resource-limited worker process
  (``freight_recovery.sandbox``); see that module for what it does and does not promise.

Still NOT done (see README "Before real customer data"): malware scanning of uploads,
rate limiting / WAF, real extraction providers, retention/deletion policy, third-party
pentest and compliance review.
"""

from __future__ import annotations

import hashlib
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from decimal import Decimal

from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Path,
    Query,
    Request,
    Security,
    UploadFile,
)
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from freight_recovery import __version__
from freight_recovery.auth import (
    AuthenticatedRoute,
    TenantContext,
    api_key_header,
    bearer_scheme,
    current_tenant,
)
from freight_recovery.config import Settings
from freight_recovery.db import AnalysisRepository, build_engine, build_sessionmaker, session_scope
from freight_recovery.db.repository import DocumentMeta
from freight_recovery.db.tables import Analysis
from freight_recovery.errors import UNPROCESSABLE_EXCEPTIONS, InputError, UnprocessableError
from freight_recovery.models import AnalysisResponse, EvidencePacket, Perspective
from freight_recovery.pipeline import run_pipeline
from freight_recovery.sandbox import (
    SandboxBusy,
    SandboxFailed,
    SandboxRunner,
    SandboxTimeout,
    SandboxTooLarge,
    SandboxUnavailable,
    analyze_in_worker,
)
from freight_recovery.storage import StorageError, StorageProvider, build_storage

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_FILES = 10
MAX_REQUEST_BYTES = 25 * 1024 * 1024  # whole request body (multipart or JSON)
MAX_TEXT_CHARS = 1_000_000  # per inline document on /v1/analyze/text
MAX_FILENAME = 255

UNPROCESSABLE = "The submitted documents could not be processed."

log = logging.getLogger("freight_recovery.api")
audit = logging.getLogger("freight_recovery.audit")  # who/what/when; never document content


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


# ---- schemas ----------------------------------------------------------------------


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


class DocumentInfo(BaseModel):
    """Metadata of a stored upload (the bytes are not returned by the API)."""

    filename: str
    sha256: str
    size_bytes: int


class AnalysisSummary(BaseModel):
    """One analysis (job) in a list."""

    id: str
    status: str
    perspective: str
    load_number: str | None
    recoverable_total: Decimal | None
    pending_review_total: Decimal | None
    error_code: str | None
    created_at: datetime
    completed_at: datetime | None
    document_count: int


class AnalysisList(BaseModel):
    """A page of the caller's analyses, newest first."""

    items: list[AnalysisSummary]
    total: int
    limit: int
    offset: int


class AnalysisRecord(AnalysisSummary):
    """A stored analysis with its documents and (when it succeeded) the full packet."""

    documents: list[DocumentInfo]
    packet: EvidencePacket | None


def _cents(value: int | None) -> Decimal | None:
    return None if value is None else Decimal(value).scaleb(-2)


def _summary(a: Analysis) -> dict:
    return {
        "id": a.id,
        "status": a.status,
        "perspective": a.perspective,
        "load_number": a.load_number,
        "recoverable_total": _cents(a.recoverable_cents),
        "pending_review_total": _cents(a.pending_review_cents),
        "error_code": a.error_code,
        "created_at": a.created_at,
        "completed_at": a.completed_at,
        "document_count": len(a.documents),
    }


# ---- analysis execution -----------------------------------------------------------


class PipelineFailure(Exception):
    """A pipeline run failed for a reason attributable to the input or to limits."""

    def __init__(
        self, status: int, detail: str, code: str, headers: dict[str, str] | None = None
    ) -> None:
        super().__init__(detail)
        self.status, self.detail, self.code, self.headers = status, detail, code, headers


def _execute(state, payload: list[tuple[str, bytes]], perspective: Perspective) -> EvidencePacket:
    """Run the pipeline (in the sandbox worker unless ``sandbox_mode=inprocess``).

    Every input-caused or limit-caused failure becomes a :class:`PipelineFailure` with a
    fixed client-safe message; exception text (which can contain document content) is
    never returned.
    """
    settings: Settings = state.settings
    try:
        if state.runner is None:  # FR_SANDBOX_MODE=inprocess: dev/tests only
            return run_pipeline(payload, perspective, settings)
        return analyze_in_worker(state.runner, payload, perspective, settings)
    except UnprocessableError as exc:
        raise PipelineFailure(422, UNPROCESSABLE, "unprocessable") from exc
    except InputError as exc:
        raise PipelineFailure(422, str(exc), "input_error") from exc
    except UNPROCESSABLE_EXCEPTIONS as exc:
        raise PipelineFailure(422, UNPROCESSABLE, "unprocessable") from exc
    except SandboxTimeout as exc:
        raise PipelineFailure(422, "Processing exceeded the time limit.", "timeout") from exc
    except SandboxTooLarge as exc:
        raise PipelineFailure(413, "Processing exceeded the size/memory limit.", "too_large") from exc
    except SandboxBusy as exc:
        raise PipelineFailure(
            503, "The server is busy; retry shortly.", "busy", {"Retry-After": "5"}
        ) from exc
    except SandboxUnavailable as exc:
        log.error("sandbox worker could not be started: %s", exc)
        raise PipelineFailure(503, "Processing is temporarily unavailable.", "worker_unavailable") from exc
    except SandboxFailed as exc:
        log.warning("sandbox worker failed: %s", exc)  # exit status only; never document content
        raise PipelineFailure(422, UNPROCESSABLE, "worker_failed") from exc


def _process(
    state, ctx: TenantContext, payload: list[tuple[str, bytes]], perspective: Perspective
) -> AnalysisResponse:
    """Persist, run and complete one analysis for ``ctx`` (blocking; run in a worker thread)."""
    settings: Settings = state.settings
    factory = state.sessionmaker
    storage: StorageProvider = state.storage
    metas = [
        DocumentMeta(name[:MAX_FILENAME], hashlib.sha256(data).hexdigest(), len(data))
        for name, data in payload
    ]

    with session_scope(factory) as s:
        analysis_id = AnalysisRepository(s, ctx.tenant_id).create(perspective.value, metas).id

    def fail(code: str) -> None:
        with session_scope(factory) as s:
            AnalysisRepository(s, ctx.tenant_id).mark_failed(analysis_id, code)
        audit.info(
            "analysis failed tenant=%s analysis=%s code=%s", ctx.tenant_id, analysis_id, code
        )

    try:
        keys = [
            storage.put(ctx.tenant_id, analysis_id, i, m.sha256, data)
            for i, (m, (_name, data)) in enumerate(zip(metas, payload))
        ]
        with session_scope(factory) as s:
            AnalysisRepository(s, ctx.tenant_id).set_storage_keys(analysis_id, keys)
    except StorageError as exc:
        log.error("document storage failed: %s", exc)
        fail("storage_unavailable")
        raise HTTPException(503, "Document storage is unavailable.") from exc

    try:
        packet = _execute(state, payload, perspective)
    except PipelineFailure as exc:
        fail(exc.code)
        raise HTTPException(exc.status, exc.detail, headers=exc.headers) from exc
    except BaseException:
        fail("internal_error")
        raise

    with session_scope(factory) as s:
        AnalysisRepository(s, ctx.tenant_id).mark_succeeded(
            analysis_id,
            packet.model_dump(mode="json"),
            packet.load_number,
            packet.result.recoverable_total,
            packet.result.pending_review_total,
        )
    audit.info(
        "analysis succeeded tenant=%s analysis=%s docs=%s",
        ctx.tenant_id,
        analysis_id,
        ",".join(m.sha256[:12] for m in metas),
    )
    return AnalysisResponse(packet=packet, analysis_id=analysis_id)


# ---- app factory ------------------------------------------------------------------


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the application. ``settings`` defaults to ``Settings.from_env()``."""
    settings = settings or Settings.from_env()
    if settings.environment == "production":
        settings.validate_for_production()

    engine = build_engine(settings.database_url)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        engine.dispose()

    app = FastAPI(
        title="Freight Recovery API (pre-product)",
        version=__version__,
        description=(
            "Ingest freight invoice / rate confirmation / BOL, apply detention and "
            "invoice-error rules, and return a recovery estimate with an evidence packet "
            "and DRAFT demand letter. Pre-product software foundation: authentication, "
            "tenant isolation, persistence and sandboxed parsing are implemented; real "
            "integrations, a third-party security audit and compliance sign-off are "
            "required before real customer data."
        ),
        docs_url=None,
        redoc_url=None,
        openapi_url=None,  # served by the gated routes below, or not at all
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessionmaker = build_sessionmaker(engine)
    app.state.storage = build_storage(settings)
    app.state.runner = (
        SandboxRunner(
            timeout=settings.sandbox_timeout_seconds,
            memory_mb=settings.sandbox_memory_mb,
            max_workers=settings.sandbox_max_workers,
            queue_timeout=settings.sandbox_queue_timeout_seconds,
        )
        if settings.sandbox_mode == "process"
        else None
    )
    if app.state.runner is None:
        log.warning("FR_SANDBOX_MODE=inprocess: parsing runs inside the API process (dev/tests only)")
    app.add_middleware(BodySizeLimitMiddleware)

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        """422 with field paths and codes only; never echo the submitted values."""
        detail = [
            {"loc": list(e.get("loc", ())), "type": e.get("type", "invalid")} for e in exc.errors()
        ]
        return JSONResponse({"detail": detail}, status_code=422)

    @app.get("/health", response_model=Health, tags=["meta"])
    def health() -> Health:
        """Liveness probe (anonymous; used by container/ALB health checks)."""
        return Health(status="ok", version=__version__)

    v1 = APIRouter(
        route_class=AuthenticatedRoute,
        dependencies=[Security(api_key_header), Security(bearer_scheme)],
        responses={401: {"description": "API key required"}, 403: {"description": "Invalid API key"}},
    )

    @v1.post("/v1/analyze", response_model=AnalysisResponse, tags=["analysis"])
    async def analyze_files(
        request: Request,
        files: list[UploadFile] = File(description="Invoice, rate confirmation, BOL (PDF/CSV/TXT)."),
        perspective: Perspective = Form(Perspective.SHIPPER),
        ctx: TenantContext = Depends(current_tenant),
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
        # Blocking work (DB, storage, parsing) runs in a worker thread, off the event loop.
        return await run_in_threadpool(_process, request.app.state, ctx, payload, perspective)

    @v1.post("/v1/analyze/text", response_model=AnalysisResponse, tags=["analysis"])
    def analyze_text(
        request: Request, req: TextAnalyzeRequest, ctx: TenantContext = Depends(current_tenant)
    ) -> AnalysisResponse:
        """Analyze inline text/CSV documents (handy for tests and integrations)."""
        payload = [(d.filename, d.content.encode("utf-8")) for d in req.documents]
        return _process(request.app.state, ctx, payload, req.perspective)

    @v1.get("/v1/analyses", response_model=AnalysisList, tags=["analysis"])
    def list_analyses(
        request: Request,
        limit: int = Query(50, ge=1, le=100),
        offset: int = Query(0, ge=0, le=1_000_000),
        ctx: TenantContext = Depends(current_tenant),
    ) -> AnalysisList:
        """The caller's analyses, newest first. Never includes other tenants' data."""
        with session_scope(request.app.state.sessionmaker) as s:
            repo = AnalysisRepository(s, ctx.tenant_id)
            return AnalysisList(
                items=[AnalysisSummary(**_summary(a)) for a in repo.list(limit, offset)],
                total=repo.count(),
                limit=limit,
                offset=offset,
            )

    @v1.get("/v1/analyses/{analysis_id}", response_model=AnalysisRecord, tags=["analysis"])
    def get_analysis(
        request: Request,
        analysis_id: str = Path(max_length=64),
        ctx: TenantContext = Depends(current_tenant),
    ) -> AnalysisRecord:
        """One stored analysis. Another tenant's id is indistinguishable from a missing one (404)."""
        with session_scope(request.app.state.sessionmaker) as s:
            a = AnalysisRepository(s, ctx.tenant_id).get(analysis_id)
            if a is None:
                raise HTTPException(404, "Analysis not found.")
            return AnalysisRecord(
                **_summary(a),
                documents=[
                    DocumentInfo(filename=d.filename, sha256=d.sha256, size_bytes=d.size_bytes)
                    for d in a.documents
                ],
                packet=EvidencePacket.model_validate(a.result) if a.result else None,
            )

    app.include_router(v1)

    if settings.docs_mode != "off":
        docs = APIRouter(
            route_class=AuthenticatedRoute if settings.docs_mode == "auth" else APIRoute,
            include_in_schema=False,
        )

        @docs.get("/openapi.json")
        def openapi_json() -> JSONResponse:
            return JSONResponse(app.openapi())

        @docs.get("/docs")
        def swagger_ui():
            return get_swagger_ui_html(
                openapi_url="/openapi.json",
                title=f"{app.title} - docs",
                swagger_ui_parameters={"persistAuthorization": True},
            )

        app.include_router(docs)

    return app


app = create_app()
