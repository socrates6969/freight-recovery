# Pre-product image. Defaults to FR_ENV=production: the app refuses to start without an
# API-key pepper, PostgreSQL and the sandboxed parser (see config.validate_for_production).
# Override FR_ENV=dev only for local experiments (docker-compose.yml does).
#
# Base image is pinned by digest (python:3.12-slim). Refresh on a schedule (Dependabot
# watches this file) and rebuild for security patches.
FROM python:3.12-slim@sha256:02108f5d322dd89f1c9e552442c25acb0543dfdbc455693a5599624f20d9155d

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    FR_ENV=production \
    FR_STORAGE_LOCAL_DIR=/data/documents

WORKDIR /app
# Hash-locked install: pip aborts if any wheel/sdist differs from requirements.txt, and
# --no-deps guarantees nothing outside the lock file is pulled in.
COPY requirements.txt .
RUN pip install --no-cache-dir --require-hashes --no-deps -r requirements.txt

COPY src ./src
# Fixed non-root uid so orchestrators can verify runAsNonRoot. /data is only used by the
# local-filesystem StorageProvider (production uses S3: mount nothing writable but /tmp).
RUN useradd --create-home --uid 10001 --no-log-init appuser \
    && mkdir -p /data/documents && chown -R 10001:10001 /data
USER 10001

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
# Migrations are a separate one-shot step (python -m freight_recovery.db.migrate), not run here.
# --proxy-headers trusts X-Forwarded-* only from FORWARDED_ALLOW_IPS (default 127.0.0.1):
# set that env var to the ALB/proxy address range when deploying behind one.
# Request-body size is capped in-app (BodySizeLimitMiddleware); also cap it at the edge.
# Parsing runs in short-lived worker subprocesses (FR_SANDBOX_*), so size task memory for
# FR_SANDBOX_MAX_WORKERS x FR_SANDBOX_MEMORY_MB plus the API process.
CMD ["uvicorn", "freight_recovery.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--limit-concurrency", "32", "--timeout-keep-alive", "5"]
