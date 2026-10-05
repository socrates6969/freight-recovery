# MVP image (pre-product). Not hardened for production: no auth, runs a single worker.
# Pinned by digest (python:3.12-slim). Refresh on a schedule and rebuild for security patches.
FROM python:3.12-slim@sha256:02108f5d322dd89f1c9e552442c25acb0543dfdbc455693a5599624f20d9155d

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src ./src
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
# --proxy-headers trusts X-Forwarded-* only from FORWARDED_ALLOW_IPS (default 127.0.0.1):
# set that env var to the ALB/proxy address range when deploying behind one.
# Request-body size is capped in-app (BodySizeLimitMiddleware); also cap it at the edge.
CMD ["uvicorn", "freight_recovery.api.main:app", "--host", "0.0.0.0", "--port", "8000",      "--proxy-headers", "--limit-concurrency", "32", "--timeout-keep-alive", "5"]
